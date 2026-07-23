using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Threading;

namespace LockedAgent;

/// <summary>
/// Orchestrates one exam session end to end. While the room is "waiting",
/// Excel is open in the background, unlocked, with no surveillance armed. The
/// moment the teacher starts the room — or immediately, if this student joins
/// after it has already started — every surveillance system arms at once:
/// fullscreen lockdown, focus watcher, keyboard hook, and periodic
/// screenshots. When the teacher ends the room, everything disarms and the
/// workbook is saved and uploaded automatically.
/// </summary>
public sealed class ExamSession
{
    private readonly string _baseUrl;
    private readonly JoinResponse _join;
    private readonly HttpClient _http = new();

    private BackendClient? _backend;
    private ExcelLauncher? _launcher;
    private FocusWatcher? _focusWatcher;
    private KeyboardHook? _keyboardHook;
    private ScreenshotService? _screenshotService;
    private OverlayWindow? _overlay;
    private WaitingWindow? _waitingWindow;
    private TestExitWindow? _testExitWindow;
    private DispatcherTimer? _heartbeatTimer;
    private bool _locked;

    public ExamSession(string baseUrl, JoinResponse join)
    {
        _baseUrl = baseUrl;
        _join = join;
    }

    public async Task StartAsync()
    {
        _backend = new BackendClient(_http, _baseUrl, _join.SessionId, _join.Lifecycle);
        _backend.Excluded += () => Application.Current.Dispatcher.Invoke(Exclude);
        _backend.RoomStarted += () => Application.Current.Dispatcher.Invoke(LockDown);
        _backend.RoomEnded += () => Application.Current.Dispatcher.Invoke(() => _ = EndExamAsync());
        _backend.StartPolling();

        string? examFilePath = null;
        if (_join.ExamFileAvailable)
        {
            var bytes = await _backend.DownloadExamFileAsync();
            if (bytes is not null)
            {
                examFilePath = Path.Combine(Path.GetTempPath(), $"locked-exam-{Guid.NewGuid():N}.xlsx");
                await File.WriteAllBytesAsync(examFilePath, bytes);
            }
        }

        _launcher = new ExcelLauncher();
        _launcher.Launch(examFilePath);

        _heartbeatTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        _heartbeatTimer.Tick += async (_, _) => await _backend.SendHeartbeatAsync();
        _heartbeatTimer.Start();

        if (_join.Lifecycle == "started")
        {
            LockDown();
        }
        else
        {
            _waitingWindow = new WaitingWindow(_join.Config.ExamTitle);
            _waitingWindow.Show();
        }
    }

    /// <summary>Arms every surveillance system at once: fullscreen, focus
    /// watcher, keyboard hook, screenshots. Idempotent — a late joiner calls
    /// this from StartAsync directly, everyone else from the RoomStarted
    /// event, never both.</summary>
    private void LockDown()
    {
        if (_locked || _launcher is null) return;
        _locked = true;

        _waitingWindow?.Close();
        _waitingWindow = null;

        _launcher.EnterFullscreenLockdown();

        _focusWatcher = new FocusWatcher(_launcher.ProcessId);
        _focusWatcher.FocusLost += OnFocusLost;
        _focusWatcher.FocusRestored += OnFocusRestored;

        _keyboardHook = new KeyboardHook();
        _keyboardHook.Install();

        _screenshotService = new ScreenshotService(
            _http, _baseUrl, _join.SessionId, _join.Config.Screenshot);
        _screenshotService.Start();

        if (_join.IsTest)
        {
            _testExitWindow = new TestExitWindow();
            _testExitWindow.ExitRequested += () => Application.Current.Dispatcher.Invoke(ExitTestMode);
            _testExitWindow.Show();
        }
    }

    /// <summary>Tester clicked "Quitter le test": disarm everything exactly
    /// like a real end-of-exam, but record a distinct event so this never
    /// shows up as a real exclusion on the teacher's dashboard.</summary>
    private void ExitTestMode()
    {
        Disarm();
        _ = _backend!.SendEventAsync("test_exit");
        _launcher?.Dispose();
        _ = _backend?.DisposeAsync();
        Application.Current.Shutdown();
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

    /// <summary>Teacher clicked "Terminer l'examen": disarm everything, save
    /// the workbook to a path we control, and upload it — see
    /// api/submission.ts on the backend.</summary>
    private async Task EndExamAsync()
    {
        Disarm();
        try
        {
            if (_launcher is not null)
            {
                var bytes = _launcher.SaveAndReadBytes();
                await _backend!.UploadSubmissionAsync(bytes, $"{_join.Config.ExamTitle}.xlsx");
            }
        }
        catch
        {
            // Best-effort: the teacher's dashboard shows whichever submissions
            // made it through; a save/upload failure shouldn't hang the agent.
        }
        finally
        {
            _launcher?.Dispose();
            _ = _backend?.DisposeAsync();
            Application.Current.Shutdown();
        }
    }

    private void Exclude()
    {
        Disarm();
        _launcher?.Dispose();
        _ = _backend?.DisposeAsync(); // app is shutting down right after; fire-and-forget is fine
        // TODO: show a dedicated "vous avez été exclu" screen and terminate Excel
        // gracefully before shutting down, instead of exiting the whole agent.
        Application.Current.Shutdown();
    }

    private void Disarm()
    {
        _keyboardHook?.Dispose();
        _focusWatcher?.Dispose();
        _screenshotService?.Dispose();
        _heartbeatTimer?.Stop();
        _overlay?.CancelCountdown();
        _waitingWindow?.Close();
        _testExitWindow?.Close();
        _testExitWindow = null;
    }
}
