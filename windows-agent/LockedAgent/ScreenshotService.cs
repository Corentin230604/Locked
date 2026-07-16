using System.Drawing;
using System.Drawing.Imaging;
using System.Net.Http;
using System.Net.Http.Headers;

namespace LockedAgent;

/// <summary>
/// Captures the screen on the interval the teacher configured for the room (fixed
/// or randomly jittered) and uploads each frame to the backend. Upload failures are
/// swallowed on purpose: a flaky network shouldn't crash the agent mid-exam.
/// </summary>
public sealed class ScreenshotService : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _roomCode;
    private readonly string _sessionId;
    private readonly ScreenshotConfig _config;
    private readonly Random _random = new();
    private Timer? _timer;

    public ScreenshotService(HttpClient http, string baseUrl, string roomCode, string sessionId, ScreenshotConfig config)
    {
        _http = http;
        _baseUrl = baseUrl;
        _roomCode = roomCode;
        _sessionId = sessionId;
        _config = config;
    }

    public void Start()
    {
        if (!_config.Enabled) return;
        ScheduleNext();
    }

    private void ScheduleNext()
    {
        int seconds = _config.IntervalMode == "random"
            ? Math.Max(1, _config.IntervalSeconds + _random.Next(-_config.JitterSeconds, _config.JitterSeconds + 1))
            : _config.IntervalSeconds;

        _timer = new Timer(async _ =>
        {
            await CaptureAndUploadAsync();
            ScheduleNext();
        }, null, TimeSpan.FromSeconds(seconds), Timeout.InfiniteTimeSpan);
    }

    private async Task CaptureAndUploadAsync()
    {
        try
        {
            using var bitmap = CaptureScreen();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            stream.Position = 0;

            using var content = new MultipartFormDataContent();
            using var imageContent = new StreamContent(stream);
            imageContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            content.Add(imageContent, "image", "screenshot.png");

            await _http.PostAsync($"{_baseUrl}/api/rooms/{_roomCode}/sessions/{_sessionId}/screenshot", content);
        }
        catch
        {
            // Best-effort upload; a dropped frame is not worth interrupting the exam for.
        }
    }

    private static Bitmap CaptureScreen()
    {
        int width = (int)System.Windows.SystemParameters.PrimaryScreenWidth;
        int height = (int)System.Windows.SystemParameters.PrimaryScreenHeight;
        var bitmap = new Bitmap(width, height);
        using var g = Graphics.FromImage(bitmap);
        g.CopyFromScreen(0, 0, 0, 0, new Size(width, height));
        return bitmap;
    }

    public void Dispose() => _timer?.Dispose();
}
