{
pkgs ? import <nixpkgs> {},
}:

(import ./default.nix {
  inherit pkgs;
}).override (old: {
  buildInputs = old.buildInputs ++ (with pkgs; [ nodePackages.bower ]);

  projectDir = toString ./.;

  shellHook = ''
    export PATH=$projectDir/scripts:$PATH
  '';
})
