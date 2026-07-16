namespace LockedAgent;

public sealed class ScreenshotConfig
{
    public bool Enabled { get; set; } = true;
    public string IntervalMode { get; set; } = "random"; // "fixed" | "random"
    public int IntervalSeconds { get; set; } = 20;
    public int JitterSeconds { get; set; } = 5;
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
}
