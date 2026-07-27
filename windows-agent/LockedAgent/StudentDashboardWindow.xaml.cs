using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;

namespace LockedAgent;

/// <summary>Shown right after login: room history, a "Rejoindre" field
/// directly on screen (the only real action available, so no fake
/// navigation was added just to have a menu), Profil and Déconnexion.</summary>
public partial class StudentDashboardWindow : Window
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly string _baseUrl;
    private readonly HttpClient _http;
    private readonly string _email;

    public StudentDashboardWindow(string baseUrl, HttpClient http, string email)
    {
        InitializeComponent();
        _baseUrl = baseUrl;
        _http = http;
        _email = email;
        GreetingText.Text = $"Connecté en tant que {email}";
        Loaded += async (_, _) => await LoadHistoryAsync();
    }

    private async Task LoadHistoryAsync()
    {
        try
        {
            var response = await _http.GetFromJsonAsync<SessionHistoryResponse>($"{_baseUrl}/api/my-sessions", JsonOptions);
            var items = (response?.Sessions ?? new List<SessionHistoryItem>())
                .Select(s => new HistoryRow
                {
                    ExamTitle = string.IsNullOrEmpty(s.Room.Config.ExamTitle) ? "Examen" : s.Room.Config.ExamTitle,
                    DateDisplay = DateTime.TryParse(s.JoinedAt, out var d) ? d.ToLocalTime().ToString("dd/MM/yyyy HH:mm") : "",
                    StatusDisplay = StatusLabel(s.Status),
                })
                .ToList();

            HistoryList.ItemsSource = items;
            EmptyHistoryText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch
        {
            // Best-effort — an empty history is a reasonable fallback if the
            // request fails (offline, server briefly down after a Render cold start).
        }
    }

    private static string StatusLabel(string status) => status switch
    {
        "active" => "En cours",
        "excluded" => "Exclu",
        "disconnected" => "Déconnecté",
        "left" => "Terminé",
        _ => status,
    };

    private async void JoinButton_Click(object sender, RoutedEventArgs e)
    {
        JoinButton.IsEnabled = false;
        StatusText.Text = "";
        try
        {
            var roomCode = RoomCodeBox.Text.Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(roomCode))
            {
                StatusText.Text = "Renseigne le code de la room.";
                return;
            }

            var response = await _http.PostAsJsonAsync($"{_baseUrl}/api/join", new { code = roomCode, studentName = _email });
            if (!response.IsSuccessStatusCode)
            {
                StatusText.Text = await JoinWindow.ExtractErrorAsync(response);
                return;
            }

            var join = await response.Content.ReadFromJsonAsync<JoinResponse>(JsonOptions)
                ?? throw new InvalidOperationException("Réponse du serveur invalide.");

            var session = new ExamSession(_baseUrl, join, _http);
            await session.StartAsync();

            Hide();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Erreur : {ex.Message}";
        }
        finally
        {
            JoinButton.IsEnabled = true;
        }
    }

    private async void ProfileButton_Click(object sender, RoutedEventArgs e)
    {
        var profile = new ProfileWindow(_baseUrl, _http, _email) { Owner = this };
        await profile.LoadAsync();
        profile.ShowDialog();
    }

    private void LogoutButton_Click(object sender, RoutedEventArgs e)
    {
        _http.DefaultRequestHeaders.Authorization = null;
        new JoinWindow().Show();
        Close();
    }

    private sealed class HistoryRow
    {
        public string ExamTitle { get; set; } = "";
        public string DateDisplay { get; set; } = "";
        public string StatusDisplay { get; set; } = "";
    }
}
