# NixOS module for Pyper.
#
# Installs the app and configures everything Wayland auto-paste needs, which is
# the main pain point for Nix users (see issue #728): ydotool, the uinput kernel
# module + udev rule, and the group memberships that let a user reach both.
#
# Example:
#   programs.pyper = {
#     enable = true;
#     users = [ "alice" ];
#   };
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pyper;
in
{
  options.programs.pyper = {
    enable = lib.mkEnableOption "Pyper voice dictation app with Wayland auto-paste support";

    users = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "alice" ];
      description = ''
        Users to grant Wayland auto-paste access. Each listed user is added to the
        ydotool group (to reach the ydotoold socket) and the uinput group (Pyper's
        own linux-fast-paste backend opens /dev/uinput directly). Leave empty to manage
        group membership yourself.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ self.packages.${pkgs.system}.default ];

    # ydotoold daemon + ydotool group + socket for Wayland keystroke injection.
    programs.ydotool.enable = true;

    # Load the uinput module and install its udev rule. programs.ydotool does not
    # do this, and Pyper's linux-fast-paste --uinput needs /dev/uinput directly.
    hardware.uinput.enable = true;

    users.users = lib.genAttrs cfg.users (_: {
      extraGroups = [
        config.programs.ydotool.group
        "uinput"
      ];
    });
  };
}
