namespace LockedAgent;

/// <summary>Small always-on-top floating panel shown during lockdown when the
/// room is flagged as a test room, so a tester isn't locked out of their own
/// PC with no clean way to leave.</summary>
public partial class TestExitWindow : System.Windows.Window
{
    public event Action? ExitRequested;

    public TestExitWindow()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            Left = System.Windows.SystemParameters.PrimaryScreenWidth - Width - 24;
            Top = 24;
        };
    }

    private void ExitButton_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        ExitRequested?.Invoke();
    }
}
