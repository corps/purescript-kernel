# purescript-kernel

A jupyter (ipython) kernel that for Purescript in the browser and in NodeJS.

Notably, this kernel treats every cell as a separate module, rather than lines entered in
`psci` or similar REPL.  Thus, this kernel feels more like a small, easy to deploy web
IDE.

Packages cannot be installed at runtime currently, although they can be configured during
installation.

Cells can be executed in browser or NodeJS mode freely by simply including a comment indicating
the expected runtime.  In browser mode, modules will be compiled via webpack and can be provided
a dom node reference to the inserted cell.

## Installation

[nixpkgs](https://github.com/NixOS/nixpkgs) is the recommended path for installation, although
hand installation is possible.

### With nix

You can install a node_module containing the complete environment + kernel directory by
building / installing the `default.nix` included.

```
let
nodePackage = pkgs.callPackage (fetchFromGithub { ... }) {};
kernelDir = nodePackage + "/lib/node_modules/purescript-webpack-kernel/purescript-webpack";
in

# Link the kernelDir to your jupyter/kernels dir.
```

An even simpler solution is to use `psbook.nix` which will build jupyter itself and configure it
to use the purescript kernel.

```
nix-build psbook.nix
./result/bin/psbook
```

### Without nix

It's possible to install this kernel without nix fairly easily.
First, you'll want to install `node`, `purs`, and `bower` yourself by hand.

You will also need to determine your destination KERNELS_DIR and substitute it below.
See the [relevant jupyter documentation](https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs)
on possible directories you can use.

```
make clean
make
make KERNELS_DIR=kernels-dir-here install
```

## Configuring purescript or npm packages

You can add / change which bower purescript modules or npm packages are available to use.
First, clean your environment

```
make clean
```

Then reinstall the bower / node modules.

```
npm install
bower install
```

Then use npm and bower to change your packages.
If you plan to use nix, you'll want to run

```
make packages
```

to update the nix expressions to match latest versions from package.json and bower.json.


Then, simply continue installation

```
make
make KERNELS_DIR=kernels-dir-here install
```

### Running in browser

By default, purescript-kernel will execute as a NodeJS module.  You may include the comment
line matching `/^-- runtime: browser/m` anywhere in your script.

When running in browser mode, you may also define a `mainWithDivId` function.  If defined, it
will receive a plain div dom element as an argument, and otherwise behave as per normal `main`. 
This div will correspond to the cell that the script is executed in.
