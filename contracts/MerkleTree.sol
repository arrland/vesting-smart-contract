// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "hardhat/console.sol";

/**
 * @title MerkleTree
 * @dev This contract allows managing merkle trees for vesting schedules in the RumToken project.
 */
contract MerkleTree is AccessControl {
    // Merkle root for the vesting schedule
    bytes32 public vestingMerkleRoot;

    // Event to be emitted when the merkle root is updated
    event MerkleRootUpdated(bytes32 indexed newMerkleRoot);

    /**
     * @dev Sets the initial merkle root for the vesting schedule.
     * @param _vestingMerkleRoot The merkle root of the vesting schedule.
     */
    constructor(bytes32 _vestingMerkleRoot) {
        vestingMerkleRoot = _vestingMerkleRoot;        
    }

    /**
     * @dev Allows updating the merkle root for the vesting schedule. This can be used to update the vesting schedules.
     * @param _newMerkleRoot The new merkle root to be set.
     */
    function updateMerkleRoot(bytes32 _newMerkleRoot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vestingMerkleRoot = _newMerkleRoot;
        emit MerkleRootUpdated(_newMerkleRoot);
    }

    /**
     * @dev Verifies a proof for a given address and amount against the stored merkle root.
     * @param _proof The merkle proof to verify.
     * @param _leaf The leaf node to verify (address and amount hashed together).
     * @return bool indicating if the proof is valid.
     */
    function verifyProof(bytes32[] calldata _proof, bytes32 _leaf) internal view returns (bool) {        
        return MerkleProof.verify(_proof, vestingMerkleRoot, _leaf);
    }
}

