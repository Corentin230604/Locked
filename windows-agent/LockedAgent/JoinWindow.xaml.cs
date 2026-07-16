using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;

namespace LockedAgent;

public partial class JoinWindow : Window
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public JoinWindow()
    {
        InitializeComponent();
    }

    private async void JoinButton_Click(object sender, RoutedEventArgs e)
    {
        JoinButton.IsEnabled = false;
        StatusText.Text = "";
        try
        {
            var baseUrl = ServerUrlBox.Text.TrimEnd('/');
            var roomCode = RoomCodeBox.Text.Trim().ToUpperInvariant();
            var studentName = StudentNameBox.Text.Trim();

            if (string.IsNullOrWhiteSpace(roomCode) || string.IsNullOrWhiteSpace(studentName))
            {
                StatusText.Text = "Merci de renseigner le code de la room et votre nom.";
                return;
            }

            using var http = new HttpClient();
            var response = await http.PostAsJsonAsync($"{baseUrl}/api/rooms/{roomCode}/join", new { studentName });
            if (!response.IsSuccessStatusCode)
            {
                StatusText.Text = $"Impossible de rejoindre la room ({(int)response.StatusCode}).";
                return;
            }

            var join = await response.Content.ReadFromJsonAsync<JoinResponse>(JsonOptions)
                ?? throw new InvalidOperationException("Réponse du serveur invalide.");

            var session = new ExamSession(baseUrl, roomCode, join);
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
}
