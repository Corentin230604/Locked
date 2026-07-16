/**
 * Minimal request/response shape shared by every api/*.ts handler. Vercel's
 * Node runtime only needs a default-exported `(req, res) => void | Promise`
 * function — it does not require the (dependency-heavy) @vercel/node
 * package at runtime, only for its types, so we define our own instead.
 * Express's req/res satisfy this shape structurally, which is what lets
 * devServer.ts reuse these same handlers for local development.
 */
export interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body: any;
}

export interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: any): void;
  headersSent: boolean;
}
