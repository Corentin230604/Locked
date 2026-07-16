using System.Diagnostics;
using System.Runtime.InteropServices;
using LockedAgent.Native;

namespace LockedAgent;

/// <summary>
/// Global low-level keyboard hook that swallows the shortcuts students would normally
/// use to escape a fullscreen app: Alt+Tab, the Windows key, Alt+F4, Ctrl+Esc.
/// Ctrl+Alt+Del cannot be, and is not, intercepted here - Windows never delivers it to
/// user-mode hooks. The FocusWatcher is what catches escapes this hook can't block.
/// </summary>
public sealed class KeyboardHook : IDisposable
{
    private readonly NativeMethods.LowLevelKeyboardProc _proc;
    private IntPtr _hookId = IntPtr.Zero;

    public KeyboardHook()
    {
        _proc = HookCallback;
    }

    public void Install()
    {
        using var curProcess = Process.GetCurrentProcess();
        using var curModule = curProcess.MainModule!;
        _hookId = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_KEYBOARD_LL,
            _proc,
            NativeMethods.GetModuleHandle(curModule.ModuleName),
            0);
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == NativeMethods.WM_KEYDOWN || wParam == NativeMethods.WM_SYSKEYDOWN))
        {
            int vkCode = Marshal.ReadInt32(lParam);
            bool altDown = (NativeMethods.GetAsyncKeyState(NativeMethods.VK_MENU) & 0x8000) != 0;
            bool ctrlDown = (NativeMethods.GetAsyncKeyState(NativeMethods.VK_CONTROL) & 0x8000) != 0;

            bool blocked =
                (vkCode == NativeMethods.VK_TAB && altDown) ||
                vkCode == NativeMethods.VK_LWIN ||
                vkCode == NativeMethods.VK_RWIN ||
                (vkCode == NativeMethods.VK_F4 && altDown) ||
                (vkCode == NativeMethods.VK_ESCAPE && ctrlDown);

            if (blocked) return (IntPtr)1; // non-zero return swallows the key system-wide
        }
        return NativeMethods.CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_hookId != IntPtr.Zero)
        {
            NativeMethods.UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
    }
}
