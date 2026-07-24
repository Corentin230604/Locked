using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;

namespace LockedAgent;

public partial class JoinWindow : Window
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    // Fixed for this deployment - the anon key is meant to be public
    // (protected by RLS policies, unlike the service_role key), so shipping
    // it in the agent binary is safe. Talked to directly (not through our own
    // backend) only for sign-in, via Supabase Auth's REST API.
    private const string SupabaseUrl = "https://kacjqpqppcqtdyebdpyi.supabase.co";
    private const string SupabaseAnonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthY2pxcHFwcGNxdGR5ZWJkcHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDQzNzAsImV4cCI6MjA5OTc4MDM3MH0.IoOLViEXo8JAHgF3QVlLiWDrIyUAq5_kGBisZjG8RpI";

    private bool _registerMode;

    public JoinWindow()
    {
        InitializeComponent();
    }

    private void ToggleModeButton_Click(object sender, RoutedEventArgs e)
    {
        _registerMode = !_registerMode;
        RegisterFields.Visibility = _registerMode ? Visibility.Visible : Visibility.Collapsed;
        ToggleModeButton.Content = _registerMode
            ? "Déjà un compte ? Se connecter"
            : "Nouveau sur Locked ? Créer un compte";
    }

    private async void JoinButton_Click(object sender, RoutedEventArgs e)
    {
        JoinButton.IsEnabled = false;
        StatusText.Text = "";
        try
        {
            var baseUrl = ServerUrlBox.Text.TrimEnd('/');
            var email = EmailBox.Text.Trim();
            var password = PasswordBox.Password;
            var roomCode = RoomCodeBox.Text.Trim().ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password) ||
                string.IsNullOrWhiteSpace(roomCode))
            {
                StatusText.Text = "Merci de renseigner votre email, votre mot de passe et le code de la room.";
                return;
            }

            // Owned by the ExamSession afterward, not disposed here - it
            // needs to stay alive (with the Bearer token attached below) for
            // the whole exam session's polling/uploads.
            var http = new HttpClient();

            var fullName = FullNameBox.Text.Trim();
            if (_registerMode)
            {
                var classCode = ClassCodeBox.Text.Trim().ToUpperInvariant();
                if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(classCode))
                {
                    StatusText.Text = "Merci de renseigner votre nom complet et le code de votre classe.";
                    return;
                }

                var registerResponse = await http.PostAsJsonAsync($"{baseUrl}/api/register-student", new
                {
                    email,
                    password,
                    name = fullName,
                    classCode,
                });
                if (!registerResponse.IsSuccessStatusCode)
                {
                    StatusText.Text = $"Inscription impossible : {await ExtractErrorAsync(registerResponse)}";
                    return;
                }
            }

            var jwt = await SignInAsync(http, email, password);
            if (jwt is null)
            {
                StatusText.Text = "Email ou mot de passe incorrect.";
                return;
            }
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

            var displayName = fullName.Length > 0 ? fullName : email;
            var response = await http.PostAsJsonAsync($"{baseUrl}/api/join", new { code = roomCode, studentName = displayName });
            if (!response.IsSuccessStatusCode)
            {
                StatusText.Text = await ExtractErrorAsync(response);
                return;
            }

            var join = await response.Content.ReadFromJsonAsync<JoinResponse>(JsonOptions)
                ?? throw new InvalidOperationException("Réponse du serveur invalide.");

            var session = new ExamSession(baseUrl, join, http);
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

    private static async Task<string?> SignInAsync(HttpClient http, string email, string password)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"{SupabaseUrl}/auth/v1/token?grant_type=password")
        {
            Content = JsonContent.Create(new { email, password }),
        };
        request.Headers.Add("apikey", SupabaseAnonKey);

        var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadFromJsonAsync<SupabaseAuthResponse>(JsonOptions);
        return body?.AccessToken;
    }

    /// <summary>Backend errors are JSON `{ error: "..." }` — show that
    /// message directly instead of dumping the raw response body.</summary>
    private static async Task<string> ExtractErrorAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        try
        {
            var parsed = JsonSerializer.Deserialize<ErrorBody>(body, JsonOptions);
            return parsed?.Error ?? body;
        }
        catch (JsonException)
        {
            return body;
        }
    }

    private sealed class ErrorBody
    {
        public string? Error { get; set; }
    }

    private sealed class SupabaseAuthResponse
    {
        [JsonPropertyName("access_token")]
        public string? AccessToken { get; set; }
    }
}
