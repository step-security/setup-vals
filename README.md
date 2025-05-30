## Setup Vals

GitHub Action for installing
[variantdev/vals](https://github.com/variantdev/vals)

Install a specific version of vals binary on the runner. Acceptable values are
latest or any semantic version string like v2.16.7 Use this action in workflow
to define which version of sops will be used.

```yaml
- name: Vals Binary Installer
  uses: step-security/setup-vals@v1
  with:
    version: '<version>' # default is latest stable
  id: install
```

The cached vals binary path is prepended to the PATH environment variable as
well as stored in the vals-path output variable. Refer to the action metadata
file for details about all the inputs
[here](https://github.com/step-security/setup-vals/blob/master/action.yml).
