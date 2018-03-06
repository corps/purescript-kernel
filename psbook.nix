{
pkgs ? import <nixpkgs> {},
writeText ? pkgs.writeText,
writeScriptBin ? pkgs.writeScriptBin,
jupyterConfig ? ''
  c.KernelSpecManager.whitelist = { "purescript" }
  # c.NotebookApp.disable_check_xsrf = True
  c.NotebookApp.token = ""
'',
nodejs ? pkgs.nodejs,
bash ? pkgs.bash,
python ? pkgs.python35,
stdenv ? pkgs.stdenv,
packaged ? import ./. {},
}:

let
packageOverrides = self: super: rec {
  nbconvert = super.nbconvert.overridePythonAttrs (old: {
    doCheck = false;
  });

  notebook = super.notebook.overridePythonAttrs (old: {
    doCheck = false;
  });

  send2trash = super.send2trash.overridePythonAttrs (old: {
    doCheck = false;
  });
};

python' = python.override { inherit packageOverrides; };

pynb = python'.buildEnv.override {
  extraLibs = with python'.pkgs; [ jupyter_core notebook ];
  ignoreCollisions = true;
};

jupyterConfigFile = writeText "jupyter_config.py" jupyterConfig;

in

writeScriptBin "psbook" ''
  #!${bash}/bin/bash

  export JUPYTER_PATH=${packaged}/lib/node_modules/purescript-kernel
  exec ${pynb}/bin/ipython notebook --config=${jupyterConfigFile} $@
''
