namespace LockedAgent;

public sealed class ScreenshotConfig
{
    public bool Enabled { get; set; } = true;

    /// <summary>1-60 captures per minute, taken at random moments within each
    /// 60-second window rather than at fixed intervals — see
    /// ScreenshotService's scheduling loop.</summary>
    public int PerMinute { get; set; } = 10;
}

public sealed class RoomConfig
{
    public string ExamTitle { get; set; } = "";
    public int CountdownSeconds { get; set; } = 15;
    public ScreenshotConfig Screenshot { get; set; } = new();
}

public sealed class JoinResponse
{
    public string SessionId { get; set; } = "";
    public string RoomId { get; set; } = "";
    public RoomConfig Config { get; set; } = new();

    /// <summary>"waiting" | "started" | "ended" at the moment this student
    /// joined — a late joiner can land directly on "started".</summary>
    public string Lifecycle { get; set; } = "waiting";

    public bool ExamFileAvailable { get; set; }

    /// <summary>All restrictions apply exactly as in a real exam, but a
    /// floating "Quitter le test" button stays available — see
    /// ExamSession.LockDown().</summary>
    public bool IsTest { get; set; }
}

public sealed class RoomStatus
{
    public string Lifecycle { get; set; } = "waiting";
    public bool ExamFileAvailable { get; set; }
    public bool IsTest { get; set; }
}

/// <summary>Shape of GET /api/session — polled every few seconds since there
/// is no server-to-agent push channel in this architecture.</summary>
public sealed class SessionStatusResponse
{
    public string Status { get; set; } = "";
    public RoomStatus? Room { get; set; }
}

/// <summary>Shape of GET /api/exam-file — a short-lived signed Supabase
/// Storage URL, never the file bytes directly from our own API.</summary>
public sealed class ExamFileResponse
{
    public string Url { get; set; } = "";
    public string Filename { get; set; } = "";
}
