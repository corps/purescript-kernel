{
pkgs ? import <nixpkgs> {},
nodejs ? pkgs."nodejs-6_x",
stdenv ? pkgs.stdenv,
bowerPackageNix ? ./bower-package.nix,
bowerJsonFile ?  stdenv.mkDerivation {
    name = "bower.json";
    src = ./bower.json;
    phases = [ "installPhase" ];
    installPhase = ''
      mkdir -p $out/
      cp $src $out/bower.json
    '';
  },
}:

stdenv.mkDerivation {
  name = "purescript-webpack-bundle";
  buildInputs = with pkgs; [ nodePackages.bower nodejs purescript ];

  projectDir = toString ./.;

  bowerComponents = pkgs.buildBowerComponents {
    name = "bower-components";
    generated = bowerPackageNix;
    src = bowerJsonFile;
  };

  shellHook = ''
    export PATH=$projectDir/scripts:$projectDir/node_modules/.bin:$PATH
    make node_modules
  '';
}
