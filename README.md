# vesting-smart-contract
## Vesting Smart Contract Documentation

### Overview
The Vesting Smart Contract is designed to manage the vesting of tokens in a secure, transparent, and efficient manner. It incorporates a vesting mechanism, Merkle tree-based proof verification for vesting schedules, and KYC verification to ensure compliance with regulatory requirements. This document outlines the key components of the contract and provides a guide on how to deploy it using Thirdweb.

### Key Components

#### VestingMechanism.sol
- **Manages Vesting Schedules**: Controls the creation, storage, and management of vesting schedules for beneficiaries, ensuring a structured release of tokens over time.
- **Token Claiming**: Enables beneficiaries to claim their vested tokens according to the predetermined vesting schedule, ensuring a fair and transparent distribution process.
- **Schedule Transferability**: Facilitates the transfer of existing vesting schedules to new beneficiaries, allowing for flexibility in token distribution and ownership.
- **Integration with MerkleTree and KYCVerification**: Seamlessly works in conjunction with `MerkleTree.sol` for secure schedule verification and `KYCVerification.sol` for regulatory compliance, enhancing the contract's functionality and security.

The `release` function in the `VestingMechanism.sol` smart contract plays a crucial role in managing the release of vested tokens to beneficiaries. Here's a step-by-step breakdown of how it works:

1. **Beneficiary Verification**: The function first ensures that the caller of the function is the intended beneficiary of the vested tokens. This is crucial for security and to prevent unauthorized access to the tokens.

2. **Vesting Schedule Check**: It checks if the beneficiary has an existing vesting schedule. If not, it attempts to create a new vesting schedule using the provided parameters and a Merkle proof for verification against the vesting Merkle root. This step is essential for initializing vesting schedules for new beneficiaries.

3. **KYC Compliance**: If KYC verification is required, the function verifies that the beneficiary has passed KYC checks. This step is crucial for compliance with regulatory requirements.

4. **Calculating Releasable Amount**: The function calculates the amount of tokens that have vested and are eligible for release to the beneficiary. This involves determining the amount vested based on the time elapsed since the start of the vesting period and subtracting any amounts that have already been released.

5. **Release Time Check**: Before releasing the tokens, the function checks if the current time is past the next eligible release time. This ensures that tokens are released according to the predetermined vesting schedule.

6. **Token Transfer**: If the above checks pass, the vested tokens are transferred from the contract to the beneficiary's address. This step finalizes the release of vested tokens.

7. **Updating Vesting Schedule**: Finally, the function updates the vesting schedule to reflect the tokens that have been released. This includes updating the amount released and the last release time.

The `release` function ensures that vested tokens are distributed to beneficiaries in a secure, compliant, and orderly manner, according to the predefined vesting schedules.

The `getVestingDetails` function in the `VestingMechanism.sol` smart contract is designed to provide comprehensive details about the vesting schedule of a beneficiary. This function is crucial for beneficiaries to understand their vesting status, including how much has already vested, how much is claimable, and when the next release of tokens is due.

### Parameters:
The function accepts a single parameter, `params`, which is a struct of type `ReleaseParams`. This struct encapsulates several key pieces of information necessary to calculate the vesting details:
- `beneficiary`: The address of the beneficiary whose vesting details are being requested.
- `totalAmount`: The total amount of tokens that are part of the vesting schedule.
- `delayInSeconds`: The delay before the vesting starts, also known as the cliff duration.
- `tgePercent`: The percentage of tokens released at the Token Generation Event (TGE).
- `vestingPeriodDays`: The total duration of the vesting period in days.
- `vestingPeriodDurationInSeconds`: The duration between each vesting interval in seconds.

### Returns:
The function returns a struct of type `VestingDetails`, which contains detailed information about the vesting schedule:
- `vestingStart`: The timestamp when the vesting starts.
- `vestingEnd`: The timestamp when the vesting ends.
- `amountClaimable`: The amount of tokens that are currently claimable by the beneficiary.
- `amountReleased`: The amount of tokens that have already been released to the beneficiary.
- `amountLeft`: The amount of tokens that are left to be released.
- `hasVestingSchedule`: A boolean indicating whether the beneficiary has an active vesting schedule.
- `nextReleaseTime`: The timestamp of the next eligible release time.
- `isClaimable`: A boolean indicating whether there are tokens that are claimable at the current time.

This function is essential for beneficiaries to monitor their vesting progress and plan for future token claims according to their vesting schedule.

#### MerkleTree.sol
- Utilizes Merkle trees to verify vesting schedules securely.
- Ensures that vesting schedules are tamper-proof and verifiable.

#### KYCVerification.sol
- Manages KYC verification status for addresses.
- Allows toggling of KYC requirements for claiming vested tokens.


## Deployment with Thirdweb CLI

Deploying the Vesting smart contract is straightforward with the Thirdweb CLI. Here's a step-by-step guide to get your contract live:

1. **Install Thirdweb CLI**: First, ensure that you have Node.js installed on your system. Then, open your terminal and run the following command to install the Thirdweb CLI globally:
   ```
   npm install -g @thirdweb-dev/cli
   ```
   This command makes the Thirdweb CLI available from any directory in your terminal.

2. **Log in to Thirdweb**: Once the CLI is installed, you need to log in to your Thirdweb account. If you don't have an account, you'll be prompted to create one. Run:
   ```
   thirdweb login
   ```
   Follow the instructions on your screen to authenticate.


3. **Deploy your contract**: Now that your project is set up, you can deploy your Vesting smart contract. Make sure your contract files are in the `contracts` directory of your project. Then, run:
   ```
   thirdweb deploy
   ```
   You'll be prompted to select the contract you wish to deploy. Choose your Vesting contract. The CLI will then compile your contract (if it hasn't been compiled yet) and deploy it to the blockchain network you select.

## Running Tests


1. **Install Dependencies**: If you haven't already, make sure to install the necessary dependencies for testing by running:
   ```
   yarn install
   ```

2. **Run Tests**: Open your terminal and execute the following command from the root of your project:
   ```
   npx hardhat test
   ```
   This command will compile your smart contracts (if they haven't been compiled yet) and run the test cases found in the `test` directory.