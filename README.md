# purescript-webpack-kernel

A jupyter (ipython) kernel that generates and runs browser javascript from purescript
via webpack bundling.

Notably, because this bundles and runs inside the web jupyter client, it does not behave like
a traditional repl.  The backing process is not a psci, but rather each cell is considered
separate module files in a temporary workspace, whose main will be invoked inside the browser
when run.

This is mostly useful for writing simple browser demonstrations with purescript.

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

To update the nix expressions to match latest versions from package.json and bower.json.


Then, simply continue installation

```
make
make KERNELS_DIR=kernels-dir-here install
```
