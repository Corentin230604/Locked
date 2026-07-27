using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;

namespace LockedAgent;

public partial class ProfileWindow : Window
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly string _baseUrl;
    private readonly HttpClient _http;
    private readonly string _email;

    public ProfileWindow(string baseUrl, HttpClient http, string email)
    {
        InitializeComponent();
        _baseUrl = baseUrl;
        _http = http;
        _email = email;
        EmailText.Text = email;
    }

    public async Task LoadAsync()
    {
        try
        {
            var response = await _http.GetFromJsonAsync<MyMembershipsResponse>($"{_baseUrl}/api/my-memberships", JsonOptions);
            var membership = response?.Memberships.FirstOrDefault(m => m.Role == "etudiant");
            if (membership is null)
            {
                SchoolText.Text = "—";
                ClassText.Text = "—";
                StatusText.Text = "—";
                return;
            }

            SchoolText.Text = membership.SchoolName;
            ClassText.Text = membership.ClassName ?? "—";
            StatusText.Text = membership.EffectiveStatus == "active"
                ? "Actif"
                : "En attente de renouvellement — contactez votre établissement";
        }
        catch
        {
            SchoolText.Text = "Impossible de charger le profil.";
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();
}
