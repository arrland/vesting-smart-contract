// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title KYCVerification
 * @dev This contract manages the KYC verification status of addresses for the RumToken ecosystem.
 * It allows the contract owner to toggle the KYC requirement and mark addresses as KYC verified.
 */
contract KYCVerification is AccessControl {
    bytes32 public constant KYC_VERIFIER_ROLE = keccak256("KYC_VERIFIER_ROLE");

    // Mapping to keep track of addresses that have passed KYC verification.
    mapping(address => bool) private _kycVerified;

    // Indicates if KYC verification is required for claiming vested tokens.
    bool public kycRequired = false;

    event KYCVerified(address indexed account);
    event KYCRequirementChanged(bool required);

    /**
     * @dev Sets up the default admin role to the deployer and grants the KYC verifier role.
     */
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(KYC_VERIFIER_ROLE, msg.sender);
    }

    /**
     * @dev Modifier to check if the caller has the KYC verifier role.
     */
    modifier onlyKYCVerifier() {
        require(hasRole(KYC_VERIFIER_ROLE, msg.sender), "KYCVerification: Caller is not a KYC verifier");
        _;
    }

    /**
     * @dev Function to set the KYC verification status of an address.
     * @param account The address to update the KYC status for.
     * @param verified The KYC status to set.
     */
    function setKYCVerified(address account, bool verified) public onlyKYCVerifier {
        _kycVerified[account] = verified;
        emit KYCVerified(account);
    }

    /**
     * @dev Function to check if an address is KYC verified.
     * @param account The address to check the KYC status for.
     * @return bool Returns true if the address is KYC verified, false otherwise.
     */
    function isKYCVerified(address account) public view returns (bool) {
        return _kycVerified[account];
    }

    /**
     * @dev Function to toggle the requirement of KYC verification for claiming vested tokens.
     */
    function toggleKYCRequirement() public onlyRole(DEFAULT_ADMIN_ROLE) {
        kycRequired = !kycRequired;
        emit KYCRequirementChanged(kycRequired);
    }
}

