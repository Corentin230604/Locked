using System.Net.Http;
using System.Windows;
using System.Windows.Threading;

namespace LockedAgent;

/// <summary>
/// Orchestrates one exam session end to end: connects to the room's realtime
/// channel, locks Excel to the foreground, and wires the focus watcher / keyboard
/// hook / screenshot capture to the events the backend and teacher dashboard expect.
/// </summary>
public sealed class ExamSession
{
    private readonly string _baseUrl;
    private readonly string _roomCode;
    private readonly JoinResponse _join;
    private readonly HttpClient _http = new();

    private BackendClient? _backend;
    private FocusWatcher? _focusWatcher;
    private KeyboardHook? _keyboardHook;
    private ScreenshotService? _screenshotService;
    private OverlayWindow? _overlay;
    private DispatcherTimer? _heartbeatTimer;

    public ExamSession(string baseUrl, string roomCode, JoinResponse join)
    {
        _baseUrl = baseUrl;
        _roomCode = roomCode;
        _join = join;
    }

    public async Task StartAsync()
    {
        _backend = new BackendClient(_baseUrl);
        _backend.Excluded += () => Application.Current.Dispatcher.Invoke(Exclude);
        await _backend.ConnectAsync();
        await _backend.JoinAsync(_roomCode, _join.SessionId);

        var excelProcess = new ExcelLauncher().Launch();

        _focusWatcher = new FocusWatcher(excelProcess.Id);
        _focusWatcher.FocusLost += OnFocusLost;
        _focusWatcher.FocusRestored += OnFocusRestored;

        _keyboardHook = new KeyboardHook();
        _keyboardHook.Install();

        _screenshotService = new ScreenshotService(
            _http, _baseUrl, _roomCode, _join.SessionId, _join.Config.Screenshot);
        _screenshotService.Start();

        _heartbeatTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        _heartbeatTimer.Tick += async (_, _) => await _backend.SendHeartbeatAsync();
        _heartbeatTimer.Start();
    }

    private void OnFocusLost()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            _overlay = new OverlayWindow(_join.Config.CountdownSeconds);
            _overlay.CountdownExpired += OnCountdownExpired;
            _overlay.Show();
            _overlay.StartCountdown();
        });
        _ = _backend!.SendEventAsync("focus_lost");
    }

    private void OnFocusRestored()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            _overlay?.CancelCountdown();
            _overlay = null;
        });
        _ = _backend!.SendEventAsync("focus_returned");
    }

    private void OnCountdownExpired()
    {
        _ = _backend!.SendEventAsync("excluded", new { reason = "countdown_expired" });
        Exclude();
    }

    private void Exclude()
    {
        _keyboardHook?.Dispose();
        _focusWatcher?.Dispose();
        _screenshotService?.Dispose();
        _heartbeatTimer?.Stop();
        _backend?.Dispose();
        // TODO: show a dedicated "vous avez été exclu" screen and terminate Excel
        // gracefully before shutting down, instead of exiting the whole agent.
        Application.Current.Shutdown();
    }
}
