{
pkgs ? import <nixpkgs> {},
writeScriptBin ? pkgs.writeScriptBin,
writeText ? pkgs.writeText,
kernelName ? "purescript-webpack",
jupyterConfig ? ''
  c.KernelSpecManager.whitelist = { "${kernelName}" }
  # c.NotebookApp.disable_check_xsrf = True
  c.NotebookApp.token = ""
'',
nodejs ? pkgs.nodejs,
bash ? pkgs.bash,
python ? pkgs.python35,
stdenv ? pkgs.stdenv,
packaged ? import ./. {},
workingDir ? "${packaged}/lib/node_modules/purescript-webpack-kernel/",
kernelJs ? "${packaged}/lib/node_modules/purescript-webpack-kernel/kernel.js",
purescript ? pkgs.purescript,
}:

let
pynb = python.buildEnv.override {
  extraLibs = with python.pkgs; [ jupyter_core notebook ];
  ignoreCollisions = true;
};

in

rec {
  jupyterConfigFile = writeText "jupyter_config.py" jupyterConfig;
  kernelJsonFile = writeText "kernel.json" (builtins.toJSON {
    display_name = "Purescript / Webpack Bundle";
    language = "purescript";
    argv = [ "${nodejs}/bin/node" kernelJs workingDir "{connection_file}" ];
  });
  kernelPackage = stdenv.mkDerivation {
    name = "kernels";
    phases = [ "installPhase" ];
    installPhase = ''
      mkdir -p $out/share/jupyter/kernels/${kernelName}/
      cp ${kernelJsonFile} $out/share/jupyter/kernels/${kernelName}/kernel.json
    '';
  };
  psbook = writeScriptBin "psbook" ''
    #!${bash}/bin/bash

    export JUPYTER_PATH=${kernelPackage}/share/jupyter
    export PATH=${purescript}/bin:$PATH
    exec ${pynb}/bin/ipython notebook --config=${jupyterConfigFile} $@
  '';
}
