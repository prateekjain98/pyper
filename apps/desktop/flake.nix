{
  description = "Pyper – privacy-first voice dictation, meeting transcription & notes";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          pyper = pkgs.callPackage ./nix/package.nix { };
        in
        {
          default = pyper;
          pyper = pyper;
        }
      );

      overlays.default = _final: _prev: {
        pyper = self.packages.x86_64-linux.pyper;
      };

      nixosModules.default = import ./nix/module.nix self;
    };
}
