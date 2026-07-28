using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows.Threading;
using LockedAgent.Native;

namespace LockedAgent;

/// <summary>
/// Polls the machine every few seconds for two anti-cheat signals the
/// keyboard hook and focus watcher can't catch: a second monitor plugged in
/// (could mirror an answer sheet on a screen off to the side) and a known
/// remote-access/AI-assistant application running (could let someone else —
/// human or not — drive the machine, or surface an answer, without ever
/// taking Excel out of focus). The process-name blocklist is a best-effort
/// heuristic, not exhaustive — anything not on this list goes undetected.
/// </summary>
public sealed class EnvironmentWatcher : IDisposable
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);

    // Process name, no ".exe", case-insensitive. Covers the most common
    // remote-desktop/screen-sharing tools and desktop AI assistants — not a
    // complete list, and easily extended if new ones show up in practice.
    private static readonly string[] ForbiddenProcessNames =
    {
        "teamviewer", "anydesk", "mstsc", "vncviewer", "winvnc", "tvnserver",
        "aeroadmin", "chromeremotedesktophost", "supremo", "ammyy",
        "chatgpt", "copilot",
    };

    private readonly DispatcherTimer _timer = new() { Interval = PollInterval };
    private readonly HashSet<string> _activeReasons = new();

    /// <summary>Fired the moment a new violation reason appears (not
    /// re-fired on every poll while it's still present).</summary>
    public event Action<string, string>? ViolationDetected; // (reason, humanMessage)

    /// <summary>Fired once a given reason is no longer observed.</summary>
    public event Action<string>? ViolationCleared;

    public EnvironmentWatcher()
    {
        _timer.Tick += (_, _) => Poll();
    }

    public void Start() => _timer.Start();

    private void Poll()
    {
        var seenThisPoll = new HashSet<string>();

        if (NativeMethods.GetSystemMetrics(NativeMethods.SM_CMONITORS) > 1)
        {
            seenThisPoll.Add("multi_monitor");
        }

        foreach (var process in Process.GetProcesses())
        {
            using (process) // GetProcesses() hands out native handles we must release
            {
                try
                {
                    var name = process.ProcessName;
                    foreach (var forbidden in ForbiddenProcessNames)
                    {
                        if (string.Equals(name, forbidden, StringComparison.OrdinalIgnoreCase))
                        {
                            seenThisPoll.Add($"forbidden_app:{name}");
                        }
                    }
                }
                catch
                {
                    // A process can exit between GetProcesses() and reading
                    // its name — skip it, it wasn't a match either way.
                }
            }
        }

        foreach (var reason in seenThisPoll)
        {
            if (_activeReasons.Add(reason))
            {
                ViolationDetected?.Invoke(reason, DescribeReason(reason));
            }
        }

        foreach (var reason in _activeReasons.ToArray())
        {
            if (!seenThisPoll.Contains(reason))
            {
                _activeReasons.Remove(reason);
                ViolationCleared?.Invoke(reason);
            }
        }
    }

    private static string DescribeReason(string reason)
    {
        if (reason == "multi_monitor") return "Écran secondaire détecté";
        if (reason.StartsWith("forbidden_app:")) return $"Application non autorisée détectée : {reason["forbidden_app:".Length..]}";
        return reason;
    }

    public void Dispose()
    {
        _timer.Stop();
    }
}
