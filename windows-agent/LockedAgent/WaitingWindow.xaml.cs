namespace LockedAgent;

/// <summary>Shown while the room is "waiting": Excel is open in the
/// background, unlocked, and no surveillance system is armed yet.</summary>
public partial class WaitingWindow : System.Windows.Window
{
    public WaitingWindow(string examTitle)
    {
        InitializeComponent();
        ExamTitleText.Text = examTitle;
    }
}
