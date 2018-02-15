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
npmPackage ? import ./npm-package.nix { inherit nodejs; },
npmPackageAttr ? "package",
purescript ? pkgs.purescript,
rsync ? pkgs.rsync,
zeromq ? pkgs.zeromq,
which ? pkgs.which
}:

npmPackage."${npmPackageAttr}".override (old: {
   dontNpmInstall = true;
   buildInputs = old.buildInputs ++ ([
     nodejs
     purescript
     rsync
     zeromq
     which
   ]);

   bowerComponents = pkgs.buildBowerComponents {
     name = "bower-components";
     generated = bowerPackageNix;
     src = bowerJsonFile;
   };

   src = ./.;

   preRebuild = ''
     make clean
     make
     mkdir -p kernels
     make KERNELS_DIR=$PWD/kernels install
   '';
})
