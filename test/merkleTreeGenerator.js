const { ethers } = require("ethers");
const keccak256 = require('keccak256');
const { MerkleTree } = require('merkletreejs');


function hashVestingEntry(entry) {
  return ethers.solidityPackedKeccak256(
    ['address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [
      ethers.getAddress(entry.beneficiary),
      entry.totalAmount,
      entry.delayInSeconds,
      entry.tgePercent,
      entry.vestingPeriodDays,
      entry.vestingPeriodDurationInSeconds
    ]
  );
}

function generateMerkleTree(vestingEntries) {  
  const leaves = vestingEntries.map(entry => hashVestingEntry(entry));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  const proofs = vestingEntries.reduce((acc, entry, index) => {
    acc[ethers.getAddress(entry.beneficiary)] = tree.getHexProof(leaves[index]);    
    return acc;
  }, {});

  return { tree, root, proofs };
}

module.exports = {
  generateMerkleTree
}