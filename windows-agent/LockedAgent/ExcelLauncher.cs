using System.IO;
using LockedAgent.Native;

namespace LockedAgent;

/// <summary>
/// Drives the locally installed Excel via late-bound COM automation
/// (Type.GetTypeFromProgID + dynamic — no PIA / COM reference needed, so this
/// compiles and works against whichever Office version is registered on the
/// student's machine). Late binding is what makes it possible to open a
/// specific imported file and call Save directly rather than simulating
/// Ctrl+S with fake keystrokes.
/// </summary>
public sealed class ExcelLauncher : IDisposable
{
    private const int XlMaximized = -4137;
    private const int XlNormal = -4143;
    private const int XlOpenXmlWorkbook = 51; // .xlsx

    private dynamic? _app;
    private dynamic? _workbook;

    public IntPtr WindowHandle { get; private set; }
    public int ProcessId { get; private set; }

    /// <summary>Opens Excel with the teacher's imported exam file if one was
    /// downloaded, otherwise a blank workbook. Starts as a normal
    /// (non-fullscreen, non-topmost) window — used during the waiting room,
    /// before the teacher starts the exam.</summary>
    public void Launch(string? filePath)
    {
        var appType = Type.GetTypeFromProgID("Excel.Application")
            ?? throw new InvalidOperationException("Excel n'est pas installé sur ce poste.");
        _app = Activator.CreateInstance(appType)
            ?? throw new InvalidOperationException("Impossible de démarrer Excel.");
        _app.Visible = true;
        _app.DisplayAlerts = false;

        _workbook = string.IsNullOrEmpty(filePath)
            ? _app.Workbooks.Add()
            : _app.Workbooks.Open(filePath);

        _app.WindowState = XlNormal;

        WindowHandle = (IntPtr)(int)_app.Hwnd;
        NativeMethods.GetWindowThreadProcessId(WindowHandle, out uint pid);
        ProcessId = (int)pid;
    }

    /// <summary>Called when the teacher clicks "Démarrer l'examen": snaps
    /// this student's Excel to a borderless fullscreen window at the same
    /// moment their surveillance systems arm.</summary>
    public void EnterFullscreenLockdown()
    {
        _app!.WindowState = XlMaximized;

        int style = NativeMethods.GetWindowLong(WindowHandle, NativeMethods.GWL_STYLE);
        style &= ~NativeMethods.WS_CAPTION & ~NativeMethods.WS_THICKFRAME;
        NativeMethods.SetWindowLong(WindowHandle, NativeMethods.GWL_STYLE, style);

        int width = (int)System.Windows.SystemParameters.PrimaryScreenWidth;
        int height = (int)System.Windows.SystemParameters.PrimaryScreenHeight;
        NativeMethods.SetWindowPos(WindowHandle, NativeMethods.HWND_TOPMOST, 0, 0, width, height,
            NativeMethods.SWP_FRAMECHANGED);
    }

    /// <summary>Saves the workbook to a location we control (so we know
    /// exactly which file to read back and upload) and returns its bytes.
    /// Called when the teacher ends the exam.</summary>
    public byte[] SaveAndReadBytes()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"locked-submission-{Guid.NewGuid():N}.xlsx");
        _workbook!.SaveAs(tempPath, XlOpenXmlWorkbook);
        return File.ReadAllBytes(tempPath);
    }

    public void Dispose()
    {
        try { _workbook?.Close(false); } catch { /* best effort on shutdown */ }
        try { _app?.Quit(); } catch { /* best effort on shutdown */ }
        _workbook = null;
        _app = null;
    }
}
