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
bash ? pkgs.bash,
python ? pkgs.python35,
stdenv ? pkgs.stdenv,
tmpDir ? "/tmp",
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
    argv = [ tmpDir "{connection_file}" ];
  });
  jupyterDir = stdenv.mkDerivation {
    name = "kernels";
    phases = [ "installPhase" ];
    installPhase = ''
      mkdir -p $out/kernels/${kernelName}/
      cp ${kernelJsonFile} $out/kernels/${kernelName}/kernel.json
    '';
  };
  jupyterWrapper = writeScriptBin "psbook" ''
    #!${bash}/bin/bash

    cd ${jupyterDir}
    export JUPYTER_PATH=$PWD
    exec ${pynb}/bin/ipython notebook --config=${jupyterConfigFile} $@
  '';
}
