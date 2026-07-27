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

    private async void ContinueButton_Click(object sender, RoutedEventArgs e)
    {
        ContinueButton.IsEnabled = false;
        StatusText.Text = "";
        try
        {
            var baseUrl = ServerUrlBox.Text.TrimEnd('/');
            var email = EmailBox.Text.Trim();
            var password = PasswordBox.Password;

            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            {
                StatusText.Text = "Merci de renseigner votre email et votre mot de passe.";
                return;
            }

            // Owned by StudentDashboardWindow/ExamSession afterward, not
            // disposed here - it needs to stay alive (with the Bearer token
            // attached below) for the whole session's polling/uploads.
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
                // Supabase never distinguishes "no account" from "wrong
                // password" (avoids leaking which emails are registered), so
                // this message can't tell which case it is either - it just
                // nudges toward the actual fix for a first-time student.
                StatusText.Text = _registerMode
                    ? "Email ou mot de passe incorrect."
                    : "Email ou mot de passe incorrect. Si vous n'avez pas encore de compte, cliquez sur « Créer un compte » ci-dessous.";
                return;
            }
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

            new StudentDashboardWindow(baseUrl, http, email).Show();
            Hide();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Erreur : {ex.Message}";
        }
        finally
        {
            ContinueButton.IsEnabled = true;
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
    internal static async Task<string> ExtractErrorAsync(HttpResponseMessage response)
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
