using System.Diagnostics;
using LockedAgent.Native;

namespace LockedAgent;

/// <summary>
/// Starts the local, installed Excel (never Excel Online) and strips its window
/// chrome so it fills the screen like a kiosk app. This only reaches into Excel's
/// own top-level window via standard window APIs - it does not, and cannot, touch
/// Excel's internal menus or feature set. Feature restrictions (Open dialog, macros,
/// etc.) are configured separately at the Office/tenant policy level.
/// </summary>
public sealed class ExcelLauncher
{
    public Process Launch()
    {
        var psi = new ProcessStartInfo
        {
            FileName = "excel.exe",
            Arguments = "/e", // start with a blank workbook, no "Open" dialog on launch
            UseShellExecute = true,
        };
        var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Excel could not be started.");

        for (int i = 0; i < 100 && process.MainWindowHandle == IntPtr.Zero; i++)
        {
            Thread.Sleep(100);
            process.Refresh();
        }
        if (process.MainWindowHandle == IntPtr.Zero)
            throw new InvalidOperationException("Excel's window did not appear in time.");

        MakeBorderlessFullscreen(process.MainWindowHandle);
        return process;
    }

    private static void MakeBorderlessFullscreen(IntPtr hWnd)
    {
        int style = NativeMethods.GetWindowLong(hWnd, NativeMethods.GWL_STYLE);
        style &= ~NativeMethods.WS_CAPTION & ~NativeMethods.WS_THICKFRAME;
        NativeMethods.SetWindowLong(hWnd, NativeMethods.GWL_STYLE, style);

        int width = (int)System.Windows.SystemParameters.PrimaryScreenWidth;
        int height = (int)System.Windows.SystemParameters.PrimaryScreenHeight;
        NativeMethods.SetWindowPos(hWnd, NativeMethods.HWND_TOPMOST, 0, 0, width, height,
            NativeMethods.SWP_FRAMECHANGED);
    }
}
