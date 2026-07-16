using SocketIOClient;

namespace LockedAgent;

/// <summary>
/// Thin wrapper around the Socket.IO connection to the Locked backend: joins the
/// room's realtime channel, relays focus/exclusion events, and listens for commands
/// the teacher's dashboard can push back (currently just a manual exclude).
/// </summary>
public sealed class BackendClient : IDisposable
{
    private readonly SocketIO _socket;

    public event Action? Excluded;

    public BackendClient(string baseUrl)
    {
        _socket = new SocketIO(baseUrl);
        _socket.On("agent:command", response =>
        {
            var command = response.GetValue<CommandPayload>();
            if (command.Type == "exclude") Excluded?.Invoke();
        });
    }

    public Task ConnectAsync() => _socket.ConnectAsync();

    public Task JoinAsync(string roomCode, string sessionId)
        => _socket.EmitAsync("agent:join", new { code = roomCode, sessionId });

    public Task SendEventAsync(string type, object? payload = null)
        => _socket.EmitAsync("agent:event", new { type, payload });

    public Task SendHeartbeatAsync() => _socket.EmitAsync("agent:heartbeat");

    public void Dispose() => _socket.Dispose();

    private sealed class CommandPayload
    {
        public string Type { get; set; } = "";
    }
}
