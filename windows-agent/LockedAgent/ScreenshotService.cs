using System.Drawing;
using System.Drawing.Imaging;
using System.Net.Http;
using System.Net.Http.Json;

namespace LockedAgent;

/// <summary>
/// Captures the screen the teacher's configured number of times per minute
/// (1-60), at random moments within each 60-second window rather than fixed
/// intervals, and uploads each frame to the backend as base64 JSON. Upload
/// failures are swallowed on purpose: a flaky network shouldn't crash the
/// agent mid-exam.
/// </summary>
public sealed class ScreenshotService : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _sessionId;
    private readonly ScreenshotConfig _config;
    private readonly Random _random = new();
    private readonly CancellationTokenSource _cts = new();
    private Task? _loopTask;

    public ScreenshotService(HttpClient http, string baseUrl, string sessionId, ScreenshotConfig config)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _sessionId = sessionId;
        _config = config;
    }

    public void Start()
    {
        if (!_config.Enabled) return;
        _loopTask = RunAsync(_cts.Token);
    }

    private async Task RunAsync(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                var windowStart = DateTime.UtcNow;

                var offsetsMs = new List<int>(_config.PerMinute);
                for (int i = 0; i < _config.PerMinute; i++)
                    offsetsMs.Add(_random.Next(0, 60_000));
                offsetsMs.Sort();

                foreach (var offsetMs in offsetsMs)
                {
                    var delay = windowStart.AddMilliseconds(offsetMs) - DateTime.UtcNow;
                    if (delay > TimeSpan.Zero) await Task.Delay(delay, token);
                    await CaptureAndUploadAsync();
                }

                var remaining = TimeSpan.FromSeconds(60) - (DateTime.UtcNow - windowStart);
                if (remaining > TimeSpan.Zero) await Task.Delay(remaining, token);
            }
        }
        catch (OperationCanceledException)
        {
            // Stopped by Dispose — expected when the exam ends or the student is excluded.
        }
    }

    private async Task CaptureAndUploadAsync()
    {
        try
        {
            using var bitmap = CaptureScreen();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            var imageBase64 = Convert.ToBase64String(stream.ToArray());

            await _http.PostAsJsonAsync($"{_baseUrl}/api/screenshot", new
            {
                sessionId = _sessionId,
                imageBase64,
            });
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

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
