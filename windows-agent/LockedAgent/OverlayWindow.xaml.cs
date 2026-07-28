using System.Windows;
using System.Windows.Threading;

namespace LockedAgent;

public partial class OverlayWindow : Window
{
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private int _remaining;

    public event Action? CountdownExpired;

    public OverlayWindow(int countdownSeconds, string? title = null, string? subtitle = null)
    {
        InitializeComponent();
        _remaining = countdownSeconds;
        CountdownText.Text = _remaining.ToString();
        if (title is not null) TitleText.Text = title;
        if (subtitle is not null) SubtitleText.Text = subtitle;
        _timer.Tick += OnTick;
    }

    private void OnTick(object? sender, EventArgs e)
    {
        _remaining--;
        CountdownText.Text = Math.Max(_remaining, 0).ToString();
        if (_remaining <= 0)
        {
            _timer.Stop();
            CountdownExpired?.Invoke();
        }
    }

    public void StartCountdown() => _timer.Start();

    public void CancelCountdown()
    {
        _timer.Stop();
        Close();
    }
}
