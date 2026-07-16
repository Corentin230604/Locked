using LockedAgent.Native;

namespace LockedAgent;

/// <summary>
/// Watches OS-level foreground window changes and reports whether Excel is still
/// the active window. This is what detects "the student switched away", independently
/// of whatever the keyboard hook manages to block.
/// </summary>
public sealed class FocusWatcher : IDisposable
{
    private readonly NativeMethods.WinEventDelegate _callback;
    private readonly uint _excelProcessId;
    private IntPtr _hook;
    private bool _isOnExcel = true;

    public event Action? FocusLost;
    public event Action? FocusRestored;

    public FocusWatcher(int excelProcessId)
    {
        _excelProcessId = (uint)excelProcessId;
        _callback = OnForegroundChanged;
        _hook = NativeMethods.SetWinEventHook(
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero,
            _callback,
            0,
            0,
            NativeMethods.WINEVENT_OUTOFCONTEXT);
    }

    private void OnForegroundChanged(
        IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
    {
        NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
        bool onExcel = pid == _excelProcessId;

        if (onExcel == _isOnExcel) return;
        _isOnExcel = onExcel;

        if (onExcel) FocusRestored?.Invoke();
        else FocusLost?.Invoke();
    }

    public void Dispose()
    {
        if (_hook != IntPtr.Zero)
        {
            NativeMethods.UnhookWinEvent(_hook);
            _hook = IntPtr.Zero;
        }
    }
}
