namespace LockedAgent;

/// <summary>Shown when a student joins after the room has already started:
/// the session sits as "pending_approval" server-side until the teacher
/// approves or denies it — see BackendClient's EntryApproved/EntryDenied
/// events. No surveillance is armed yet, mirrors WaitingWindow.</summary>
public partial class AirlockWindow : System.Windows.Window
{
    public AirlockWindow(string examTitle)
    {
        InitializeComponent();
        ExamTitleText.Text = examTitle;
    }
}
