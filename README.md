# Overview

`pandoras-box` is a small transaction stress testing tool, part of any Ethereum client developer's toolkit.
It is made for Ethereum-compatible blockchain networks, such as Ethereum networks, Polygon Edge, HyperLedger and others.

The key features of `pandoras-box` are the following:

-   ✅ Supports transaction batching, making stress testing orchestration hassle-free
-   ✅ Supports multiple stress testing modes
-   ✅ Supports distributed transaction stress testing through subaccounts
-   ✅ Automatic subaccount fund top-off
-   ✅ Has detailed statistics calculation
-   ✅ Has support for outputting cycle-run results

# Usage Example

```bash
Usage: pandoras-box [options]

A small and simple stress testing tool for Ethereum-compatible blockchain clients

Options:
  -V, --version                        output the version number
  -url, --json-rpc <json-rpc-address>  The URL of the JSON-RPC for the client
  -m, --mnemonic <mnemonic>            The mnemonic used to generate spam
                                       accounts
  -s, -sub-accounts <sub-accounts>     The number of sub-accounts that will
                                       send out transactions (default: "10")
  -t, --transactions <transactions>    The total number of transactions to be
                                       emitted (default: "2000")
  -m, --mode <mode>                    The mode for the stress test. Possible
                                       modes: [EOA, ERC20, ERC721, GREETER]
                                       (default: "EOA")
  -o, --output <output-path>           The output path for the results JSON
  -b, --batch <batch>                  The batch size of JSON-RPC transactions
                                       (default: "20")
  -h, --help                           display help for command
```

For any stress test run, there need to be funds on a specific address.
The address that is in charge of funds distribution to subaccounts is the **first address** with index 0 in the
specified mnemonic.

To initiate a 100 transaction `EOA` stress test run on an Ethereum-compatible blockchain network with a JSON-RPC
endpoint
at `http://127.0.0.1:10002`, with batch limits being `5000`, and outputting the result to a file:

```bash
pandoras-box -url http://127.0.0.1:10002 -m "erupt oven loud noise rug proof sunset gas table era dizzy vault" -t 100 -b 5000 -o ./myOutput.json
```

![Banner](.github/demo.gif)

# Modes

## EOA

The `EOA` mode is pretty straightforward - it is a simple value transfer mode between regular Ethereum accounts.
This mode sends out transactions with a certain value transfer between subaccounts.

## ERC20

The `ERC20` mode deploys an ERC20 token to the blockchain network being tested before starting the cycle run.
When the cycle run begins, the transactions that are sent out are ERC20 token transfers between subaccounts.

## ERC721 ⚠️WIP

The `ERC721` mode deploys an ERC721 NFT contract to the blockchain network being tested before starting the cycle run.
When the cycle run begins, the transactions that are sent out are ERC721 NFT mints.

# License

Copyright 2022 Trapesys

Licensed under the Apache License, Version 2.0 (the “License”); you may not use this file except in compliance with the
License. You may obtain a copy of the License at

## http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an “
AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific
language governing permissions and limitations under the License.
