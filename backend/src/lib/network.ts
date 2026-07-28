import type { VercelRequest } from "./httpTypes";

/**
 * Client IP as seen by the backend. Render (and Vercel) sit behind a proxy
 * that sets `x-forwarded-for` to "client, proxy1, proxy2, ..." — the first
 * entry is the original client. Falls back to the raw socket address for
 * local dev, where there's no proxy in front of Express.
 */
export function getClientIp(req: VercelRequest): string | null {
  const header = req.headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value) return value.split(",")[0].trim();

  const socketAddr = (req as any).socket?.remoteAddress ?? (req as any).connection?.remoteAddress;
  if (!socketAddr) return null;
  // IPv4-mapped IPv6 form ("::ffff:203.0.113.4") — strip the prefix so it
  // matches plain-IPv4 CIDR ranges.
  return String(socketAddr).replace(/^::ffff:/, "");
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** IPv4 only — school networks/Render's forwarded addresses are IPv4 in
 * practice today; an IPv6 client will simply fail to match any range. */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  if (ipNum === null || rangeNum === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

/** Empty allowlist = no restriction configured (default, backward
 * compatible). Otherwise the client IP must fall in at least one range. */
export function isIpAllowed(ip: string | null, allowedRanges: string[]): boolean {
  if (allowedRanges.length === 0) return true;
  if (!ip) return false;
  return allowedRanges.some((cidr) => ipMatchesCidr(ip, cidr));
}

/** A single IP is valid shorthand for "that exact address" (implicit /32);
 * used to validate admin input before storing it. */
export function isValidIpOrCidr(value: string): boolean {
  const [range, bitsStr] = value.split("/");
  if (bitsStr !== undefined && !/^\d+$/.test(bitsStr)) return false;
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  return bits >= 0 && bits <= 32 && ipToInt(range) !== null;
}
