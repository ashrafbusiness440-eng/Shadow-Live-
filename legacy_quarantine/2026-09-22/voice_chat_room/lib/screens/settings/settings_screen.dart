import 'package:flutter/material.dart';
import '../../services/navigation_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Settings'),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSection(
              'Account',
              [
                _buildSettingTile(
                  icon: Icons.person,
                  title: 'Profile Settings',
                  onTap: () => NavigationService.navigateTo(AppRoutes.profile),
                ),
                _buildSettingTile(
                  icon: Icons.notifications,
                  title: 'Notification Preferences',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.privacy_tip,
                  title: 'Privacy',
                  onTap: () => NavigationService.goBack(),
                ),
              ],
            ),
            _buildSection(
              'Audio',
              [
                _buildSettingTile(
                  icon: Icons.mic,
                  title: 'Microphone Settings',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.volume_up,
                  title: 'Sound Quality',
                  subtitle: 'High Quality',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.noise_control_off,
                  title: 'Noise Cancellation',
                  trailing: Switch(
                    value: true,
                    onChanged: (value) {},
                    activeColor: Colors.yellow[700],
                  ),
                ),
              ],
            ),
            _buildSection(
              'Appearance',
              [
                _buildSettingTile(
                  icon: Icons.dark_mode,
                  title: 'Dark Mode',
                  trailing: Switch(
                    value: true,
                    onChanged: (value) {},
                    activeColor: Colors.yellow[700],
                  ),
                ),
                _buildSettingTile(
                  icon: Icons.font_download,
                  title: 'Text Size',
                  subtitle: 'Medium',
                  onTap: () {},
                ),
              ],
            ),
            _buildSection(
              'General',
              [
                _buildSettingTile(
                  icon: Icons.language,
                  title: 'Language',
                  subtitle: 'English',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.storage,
                  title: 'Clear Cache',
                  subtitle: '234 MB',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.help,
                  title: 'Help & Support',
                  onTap: () {},
                ),
                _buildSettingTile(
                  icon: Icons.info,
                  title: 'About',
                  onTap: () {},
                ),
              ],
            ),
            const SizedBox(height: 24),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextButton(
                onPressed: () => NavigationService.navigateToAndRemoveUntil(AppRoutes.login),
                style: TextButton.styleFrom(
                  foregroundColor: Colors.red[400],
                ),
                child: const Text('Log Out'),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(String title, List<Widget> tiles) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: Colors.grey[900],
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: tiles,
          ),
        ),
      ],
    );
  }

  Widget _buildSettingTile({
    required IconData icon,
    required String title,
    String? subtitle,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: Colors.white),
      title: Text(title),
      subtitle: subtitle != null ? Text(subtitle) : null,
      trailing: trailing ?? const Icon(Icons.chevron_right, color: Colors.grey),
      onTap: onTap,
    );
  }
}