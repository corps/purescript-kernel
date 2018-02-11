{
pkgs ? import <nixpkgs> {},
nodejs ? pkgs."nodejs-6_x",
stdenv ? pkgs.stdenv,
}:

stdenv.mkDerivation {
  name = "purescript-webpack-bundle";
  buildInputs = with pkgs; [ nodePackages.bower nodejs purescript ];

  projectDir = toString ./.;

  shellHook = ''
    export PATH=$projectDir/scripts:$projectDir/node_modules/.bin:$PATH
    make node_modules
  '';
}
