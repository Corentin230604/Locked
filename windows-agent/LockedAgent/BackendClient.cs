using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace LockedAgent;

/// <summary>
/// REST client for the Locked backend (Vercel functions + Supabase — no
/// Socket.IO). There is no server-to-agent push channel in this architecture,
/// so a teacher-triggered exclusion is discovered by polling this session's
/// own row rather than receiving a pushed command.
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

    public event Action? Excluded;

    public BackendClient(HttpClient http, string baseUrl, string sessionId)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _sessionId = sessionId;
    }

    public Task SendEventAsync(string type, object? payload = null)
        => _http.PostAsJsonAsync($"{_baseUrl}/api/events", new { sessionId = _sessionId, type, payload });

    public Task SendHeartbeatAsync()
        => _http.PostAsJsonAsync($"{_baseUrl}/api/heartbeat", new { sessionId = _sessionId });

    public void StartPollingForExclusion()
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

                if (session?.Status == "excluded")
                {
                    Excluded?.Invoke();
                    return;
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

    private sealed class SessionStatusResponse
    {
        public string Status { get; set; } = "";
    }
}
