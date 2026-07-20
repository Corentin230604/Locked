using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace LockedAgent;

/// <summary>
/// REST client for the Locked backend (Vercel functions + Supabase — no
/// Socket.IO). There is no server-to-agent push channel in this architecture,
/// so exclusion and room lifecycle transitions (waiting -> started -> ended)
/// are all discovered by polling this session's own row.
/// </summary>
public sealed class BackendClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);

    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _sessionId;
    private readonly CancellationTokenSource _cts = new();
    private Task? _pollTask;
    private string _lastLifecycle;

    public event Action? Excluded;
    public event Action? RoomStarted;
    public event Action? RoomEnded;

    public BackendClient(HttpClient http, string baseUrl, string sessionId, string initialLifecycle)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _sessionId = sessionId;
        _lastLifecycle = initialLifecycle;
    }

    public Task SendEventAsync(string type, object? payload = null)
        => _http.PostAsJsonAsync($"{_baseUrl}/api/events", new { sessionId = _sessionId, type, payload });

    public Task SendHeartbeatAsync()
        => _http.PostAsJsonAsync($"{_baseUrl}/api/heartbeat", new { sessionId = _sessionId });

    /// <summary>Downloads the exam file the teacher imported, if any, via a
    /// short-lived signed URL — the agent never gets Storage credentials.</summary>
    public async Task<byte[]?> DownloadExamFileAsync()
    {
        ExamFileResponse? info;
        try
        {
            info = await _http.GetFromJsonAsync<ExamFileResponse>(
                $"{_baseUrl}/api/exam-file?sessionId={_sessionId}", JsonOptions);
        }
        catch
        {
            return null;
        }
        if (info is null || string.IsNullOrEmpty(info.Url)) return null;
        return await _http.GetByteArrayAsync(info.Url);
    }

    /// <summary>Uploads the student's saved workbook once the exam ends.</summary>
    public Task UploadSubmissionAsync(byte[] fileBytes, string filename)
        => _http.PostAsJsonAsync($"{_baseUrl}/api/submission", new
        {
            sessionId = _sessionId,
            fileBase64 = Convert.ToBase64String(fileBytes),
            filename,
        });

    public void StartPolling()
    {
        _pollTask = PollLoopAsync(_cts.Token);
    }

    private async Task PollLoopAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(PollInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(token))
            {
                SessionStatusResponse? session;
                try
                {
                    session = await _http.GetFromJsonAsync<SessionStatusResponse>(
                        $"{_baseUrl}/api/session?sessionId={_sessionId}", JsonOptions, token);
                }
                catch
                {
                    continue; // transient network/server error — retry on the next tick
                }
                if (session is null) continue;

                if (session.Status == "excluded")
                {
                    Excluded?.Invoke();
                    return;
                }

                var lifecycle = session.Room?.Lifecycle ?? _lastLifecycle;
                if (lifecycle != _lastLifecycle)
                {
                    var previous = _lastLifecycle;
                    _lastLifecycle = lifecycle;

                    if (lifecycle == "started" && previous == "waiting")
                    {
                        RoomStarted?.Invoke();
                    }
                    else if (lifecycle == "ended")
                    {
                        RoomEnded?.Invoke();
                        return;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Polling stopped by DisposeAsync — expected on normal shutdown.
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        if (_pollTask is not null)
        {
            try { await _pollTask; } catch (OperationCanceledException) { }
        }
        _cts.Dispose();
    }
}
