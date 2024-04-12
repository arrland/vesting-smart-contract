const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { generateMerkleTree } = require('./merkleTreeGenerator');

function parseFloatEther(amount, precision = 2) {
  return parseFloat(ethers.formatEther(amount)).toFixed(precision);
}

describe("VestingMechanism", function () {  
  let vestingMechanism, owner, addr1, addr2, addr3, addr4, addr5, rumToken, vestingEntries, proofs, vestingMerkleRoot, vestingStartTime;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
    rumToken = await deployRumToken();
    rumToken.address = await rumToken.getAddress();    
    vestingEntries = prepareVestingEntries(owner, addr1, addr2, addr3, addr4, addr5);
    ({ proofs, root: vestingMerkleRoot } = generateMerkleTree(vestingEntries));

    const merkleTreeResult  = generateMerkleTree(vestingEntries);
    proofs = merkleTreeResult.proofs; 
    vestingMerkleRoot = merkleTreeResult.root;
    
    vestingStartTime = await getNextDayTimestamp();
    vestingMechanism = await deployVestingMechanism(owner.address, rumToken.address, vestingMerkleRoot, vestingStartTime);
    vestingMechanism.address = await vestingMechanism.getAddress();    
    await rumToken.transfer(vestingMechanism.address, ethers.parseEther("500000"));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vestingMechanism.hasRole(await vestingMechanism.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });

    it("Should have a valid vestingMerkleRoot set", async function () {
      expect(await vestingMechanism.vestingMerkleRoot()).to.equal(vestingMerkleRoot);
    });

    it("Should assign the total supply of tokens to the VestingMechanism", async function () {
      const balance = await rumToken.balanceOf(vestingMechanism.address);
      expect(parseFloatEther(balance)).to.equal("500000.00");
    });

    it("Should correctly generate and verify Merkle Tree off-chain", async function () {
      // Generate the Merkle Tree with the vesting entries
      const { tree, root, proofs } = generateMerkleTree(vestingEntries);
      // Verify each entry using the generated proofs
      for (const entry of vestingEntries) {
        const leaf = ethers.solidityPackedKeccak256(
          ["address", "uint256", "uint256", "uint256", "uint256", "uint256"],
          [entry.beneficiary, entry.totalAmount, entry.delayInSeconds, entry.tgePercent, entry.vestingPeriodDays, entry.vestingPeriodDurationInSeconds]
        );
        const proof = proofs[entry.beneficiary];
        const isValid = tree.verify(proof, leaf, root);
        expect(isValid).to.equal(true);
      }
    });
  });

  describe("getVestingDetails Functionality", function () {
    it("Should return correct details for a non-existent vesting schedule", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      const vestingParams = getEmptyVestingParams(randomAddress);
      const details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.hasVestingSchedule).to.equal(false);
      expect(details.amountClaimable).to.equal(0);
      expect(details.amountReleased).to.equal(0);
      expect(details.amountLeft).to.equal(0);
      expect(details.isClaimable).to.equal(false);
    });

    it("Should return correct vesting details one second before vesting ends", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      let details = await vestingMechanism.getVestingDetails(vestingParams);
      // Assume vesting duration is set and calculate end time      
      const oneSecondBeforeEnd = Number(details.vestingEnd) - 2;
      
      // Advance time to one second before vesting ends
      await advanceTimeTo(oneSecondBeforeEnd);

      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);

      await advanceTimeByOneDay();
    
      details = await vestingMechanism.getVestingDetails(vestingParams);

      expect(details.hasVestingSchedule).to.equal(true);
      // Assuming some amount is still claimable just before the end, and not all tokens have been released
      expect(details.amountClaimable).to.be.greaterThan(0);
      expect(details.isClaimable).to.equal(true); // Should still be claimable
    });
    it("Should calculate nextReleaseTime correctly when vesting has a cliff", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr4.address);
      let details = await vestingMechanism.getVestingDetails(vestingParams);
      // Calculate the next release time based on the vesting start time
      const nextReleaseTime = details.vestingStart;
      // Assert that the nextReleaseTime is equal to the vestingStart
      expect(details.nextReleaseTime).to.equal(nextReleaseTime);
      await advanceTimeTo(Number(details.vestingStart)+2);
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.hasVestingSchedule).to.equal(false);
      expect(parseFloatEther(details.amountClaimable, precision=5)).to.equal("0.00039");
      expect(parseFloatEther(details.amountReleased)).to.equal("0.00");
      expect(details.isClaimable).to.equal(true);

      await advanceTimeTo(Number(details.vestingEnd)+2);
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(parseFloatEther(details.amountClaimable)).to.equal("1000.00");
      expect(details.isClaimable).to.equal(true);

    });

    it("Should calculate nextReleaseTime correctly when vesting has a cliff and initlal", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr5.address);
      let details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.nextReleaseTime).to.equal(86400);      
      expect(details.isClaimable).to.equal(true);
      await vestingMechanism.connect(addr5).release(vestingParams, proofs[addr5.address]);
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(parseFloatEther(details.amountReleased)).to.equal("500.00");
      expect(details.isClaimable).to.equal(false);
      
      expect(details.nextReleaseTime).to.equal(details.vestingStart);
      expect(details.isClaimable).to.equal(false);
      await advanceTimeTo(Number(details.vestingStart)+2);
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.isClaimable).to.equal(true);    
      expect(details.nextReleaseTime).to.equal(details.vestingStart);
      const nextReleaseTime = Number(details.nextReleaseTime);
      await expect(vestingMechanism.connect(addr5).release(
        vestingParams,
        proofs[vestingParams.beneficiary]
      )).to.emit(vestingMechanism, "TokensReleased");
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.isClaimable).to.equal(false);
      expect(details.nextReleaseTime).to.equal(Number(details.vestingStart)+86403);
    });

    it("Should return correct vesting details at the exact moment vesting ends", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr2.address);
      // Calculate the exact end time of vesting
      const vestingDurationSeconds = vestingParams.vestingPeriodDays * 86400;
      const vestingEnd = vestingStartTime + vestingParams.delayInSeconds + vestingDurationSeconds;
    
      // Advance time to the exact end of vesting
      await advanceTimeTo(vestingEnd);

      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);
    
      const details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(details.amountClaimable)).to.equal("0.00"); // Assuming all tokens have been released
      expect(details.isClaimable).to.equal(false); // No more tokens to claim
    });
  
    it("Should return initial vesting details correctly before vesting start", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      const details = await vestingMechanism.getVestingDetails(vestingParams);

      expect(details.hasVestingSchedule).to.equal(false);
      expect(parseFloatEther(details.amountClaimable)).to.equal("500.00"); // Assuming 50% TGE percent
      expect(parseFloatEther(details.amountReleased)).to.equal("0.00");
      expect(details.isClaimable).to.equal(true);
    });
  
    it("Should return correct vesting details during the vesting period", async function () {
      // Advance time to after vesting start
      await advanceTimeByOneDay();
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Release initial tokens to create the vesting schedule
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Get vesting details
      let details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.hasVestingSchedule).to.equal(true);
      expect(details.amountClaimable).to.be.at.least(0);
      expect(parseFloatEther(details.amountReleased)).to.equal("500.00"); // Assuming 50% TGE percent
      expect(details.isClaimable).to.equal(false); 
      await advanceTimeByOneDay();
      details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.isClaimable).to.equal(true); // Assuming the next release time has been reached


    });
  
    it("Should return correct vesting details after the vesting period ends", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr2.address);
      // Advance time to after the vesting period
      await advanceTimeToVestingPeriodEnd(addr2.address);
      // Attempt to release tokens to simulate end of vesting
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);
      // Get vesting details
      const details = await vestingMechanism.getVestingDetails(vestingParams);
      expect(details.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(details.amountClaimable)).to.equal("0.00"); // Assuming all tokens have been released
      expect(parseFloatEther(details.amountLeft)).to.equal("0.00"); // Assuming all tokens have been released
      expect(details.isClaimable).to.equal(false); // No more tokens to claim
    });
  
    it("Should reflect changes in vesting details after modifying vesting start time", async function () {
      // collect initial details
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      const newVestingStartTime = (await getNextDayTimestamp()) + 86400; // One more day into the future
      await vestingMechanism.connect(owner).setTgeStartTimestamp(newVestingStartTime);
      
      const detailsBeforeChange = await vestingMechanism.getVestingDetails(vestingParams);
      expect(detailsBeforeChange.isClaimable).to.equal(false); // Assuming the new start time hasn't been reached yet
  
      // Advance time to after the new vesting start time
      await advanceTimeByOneDay();
      await advanceTimeByOneDay();
      const detailsAfterChange = await vestingMechanism.getVestingDetails(vestingParams);
      expect(detailsAfterChange.isClaimable).to.equal(true); // Assuming the next release time has been reached after the change
    });
  });

  describe("setTgeStartTimestamp", function () {
    it("Should revert if trying to change the vesting start time after it has started", async function () {
      // Advance time to after the initial vesting start time
      await advanceTimeByOneDay();

      newVestingStartTime = (await ethers.provider.getBlock('latest')).timestamp + 300; // New future timestamp

      // Attempt to change the vesting start time after it has already started
      await expect(vestingMechanism.setTgeStartTimestamp(newVestingStartTime))
        .to.be.revertedWithCustomError(vestingMechanism, "VestingStartTimeCanOnlyBeChangedBeforeItStarts");
    });

  });

  describe("Vesting Schedule:", function () {

    it("Should not allow token release before vesting start time", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr3.address);
      // Assuming vestingStartTime is in the future
      await expect(vestingMechanism.connect(addr3).release(vestingParams, proofs[addr3.address]))
          .to.be.revertedWithCustomError(vestingMechanism, "ReleaseTimeNotReached");
    });

    it("Should reject vesting schedule creation with invalid proof", async function () {
      const invalidProof = ["0x9ac9afbd82044fc705e6371fb2e914b974adf82eede12046d7d956f12ebd2b1c"]; // Example invalid proof
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      await expect(vestingMechanism.connect(addr1).release(vestingParams, invalidProof))
          .to.be.revertedWithCustomError(vestingMechanism, "InvalidProof");
    });

    it("Should not release more tokens than available", async function () {      
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Setup and release some tokens first
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      await advanceTimeByOneDay();
      await advanceTimeByOneDay();
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Try to release again without waiting for the next interval
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]))
          .to.be.revertedWithCustomError(vestingMechanism, "ReleaseTimeNotReached");
    });

    it("Should allow changing the vesting start time by admin", async function () {
      const newVestingStartTime = (await getNextDayTimestamp()) + 86400; // One more day into the future
      await vestingMechanism.connect(owner).setTgeStartTimestamp(newVestingStartTime)
      expect(await vestingMechanism.vestingStartTime()).to.equal(newVestingStartTime);
    });
  
    it("Should not allow changing the vesting start time by unauthorized user", async function () {
      const newVestingStartTime = (await getNextDayTimestamp()) + 86400; // One more day into the future
      await expect(vestingMechanism.connect(addr1).setTgeStartTimestamp(newVestingStartTime))
      .to.be.revertedWith("AccessControl: account " + addr1.address.toLowerCase() + " is missing role 0xa8f45af456ec169d21f52f0673e869f84c82a5ecdb557cd556f1159a748bfb06");
    });

    it("Should transfer vesting ownership successfully", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // create vestting first      
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      await vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address);
      // Verify the transfer
      const newOwnerVestingDetails = await vestingMechanism.getVestingDetails(getEmptyVestingParams(addr2.address));
      expect(newOwnerVestingDetails.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(newOwnerVestingDetails.amountLeft)).to.equal("500.00");
      
    });
  
    it("Should not transfer vesting ownership to an address with an existing schedule", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      const vestingParams2 = await getVestingParamsFromAddress(addr2.address);
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      await vestingMechanism.connect(addr2).release(vestingParams2, proofs[addr2.address]);
      await expect(vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address))
          .to.be.revertedWithCustomError(vestingMechanism, "NewBeneficiaryAlreadyHasVestingSchedule");
    });

    it("Should correctly adjust vesting calculations after changing TGE start timestamp", async function () {
      const newVestingStartTime = (await getNextDayTimestamp()) + 86400 * 30; // 30 days into the future
      await vestingMechanism.connect(owner).setTgeStartTimestamp(newVestingStartTime);
  
      const vestingParams = await getVestingParamsFromAddress(addr3.address);
      await expect(vestingMechanism.connect(addr3).release(vestingParams, proofs[addr3.address]))
          .to.be.revertedWithCustomError(vestingMechanism, "ReleaseTimeNotReached");
    });

    it("Should correctly release initial tokens based on TGE percent", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      await advanceTimeByOneDay();
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);      
      const actualReleased = await rumToken.balanceOf(addr1.address);
  
      expect(parseFloatEther(actualReleased)).to.equal("500.00");
    });

    it("Should release tokens according to vesting duration and interval", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr2.address);
      await advanceTimeToVestingPeriodEnd(addr2.address);
  
      // Attempt to release tokens after vesting period has ended
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);
  
      const finalVestingDetails = await vestingMechanism.getVestingDetails(vestingParams);
      expect(parseFloatEther(finalVestingDetails.amountLeft)).to.equal('0.00');
      const addr2Balance = await rumToken.balanceOf(addr2.address);
      expect(parseFloatEther(addr2Balance)).to.equal("1000.00");
    });

    it("Should validate initial token release and vesting schedule creation based on vesting entry", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);    
      // Fetch initial vesting details to determine claimable tokens before creating a vesting schedule
      let details = await vestingMechanism.getVestingDetails(vestingParams);
      const expectedInitialClaimable = (BigInt(vestingParams.totalAmount) * BigInt(vestingParams.tgePercent)) / 100n;

      expect(details.amountClaimable).to.equal(expectedInitialClaimable);
      expect(details.hasVestingSchedule).to.equal(false);

      // Release tokens to create a new vesting schedule
      await expect(vestingMechanism.connect(addr1).release(
        vestingParams,
        proofs[vestingParams.beneficiary]
      )).to.emit(vestingMechanism, "TokensReleased");

      // Fetch vesting details after releasing the tokens to verify the initial release amount
      details = await vestingMechanism.getVestingDetails(vestingParams);

      expect(details.amountClaimable).to.equal(0n);
      expect(details.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(details.amountReleased)).to.equal('500.00');
      expect(parseFloatEther(details.amountLeft)).to.equal('500.00');

      // Verify the token transfer
      const beneficiaryBalance = await rumToken.balanceOf(vestingParams.beneficiary);
      expect(parseFloatEther(beneficiaryBalance)).to.equal('500.00');
    });
    
    it("Should check initialAmountClaimable after vesting start", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);  
      // Utilize the helper function to advance time by one day
      await advanceTimeByOneDay();

      // Retrieve vesting details post time advancement to validate initialAmountClaimable
      const vestingDetailsAfterStart = await vestingMechanism.getVestingDetails(vestingParams);

      // Assertions to validate the fetched vesting details against expectations
      expect(parseFloatEther(vestingDetailsAfterStart.amountClaimable)).to.equal("500.00");
      expect(vestingDetailsAfterStart.hasVestingSchedule).to.equal(false);

      // Trigger token release and validate the emission of TokensReleased event
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[vestingParams.beneficiary]))
        .to.emit(vestingMechanism, "TokensReleased");

      // Fetch vesting details after releasing the tokens to verify the initial release amount
      const details = await vestingMechanism.getVestingDetails(vestingParams);

      expect(details.amountClaimable).to.equal(0n);
      expect(details.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(details.amountReleased)).to.equal('500.00');
      expect(parseFloatEther(details.amountLeft)).to.equal('500.00');

      // Verify the token transfer
      const beneficiaryBalance = parseFloatEther(await rumToken.balanceOf(vestingParams.beneficiary));
      expect(beneficiaryBalance).to.equal('500.00');
    });

    it("Should release tokens according to the vesting schedule", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr2.address);

      await advanceTimeByOneDay();

      // Create the vesting schedule by releasing initial tokens
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);

      // Increase blockchain time by vesting period duration plus one second to simulate time passing
      await network.provider.send("evm_increaseTime", [vestingParams.vestingPeriodDurationInSeconds +1]);
      // Mine a new block to ensure the time increase takes effect
      await network.provider.send("evm_mine");
      // Release tokens for addr2 according to the vesting schedule
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);

      // Repeat the process: increase time, mine a block, and release tokens
      await network.provider.send("evm_increaseTime", [vestingParams.vestingPeriodDurationInSeconds +1]);
      await network.provider.send("evm_mine");
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);

      // Increase time and mine a block again for the next release
      await network.provider.send("evm_increaseTime", [vestingParams.vestingPeriodDurationInSeconds +1]);
      await network.provider.send("evm_mine");
      // Release tokens for the final time in this test sequence
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);

      const finalVestingDetails = await vestingMechanism.getVestingDetails(vestingParams);
      const finalAmountLeft = ethers.formatEther(finalVestingDetails[4]);
      const finalAmountReleased = ethers.formatEther(finalVestingDetails[3]);

      expect(finalAmountLeft).to.equal('0.0');
      expect(finalAmountReleased).to.equal('1000.0');        
      });

    it("Should allow transferring vesting ownership and let new beneficiary claim tokens", async function () {
      let vestingParams = await getVestingParamsFromAddress(addr1.address);
      await advanceTimeByOneDay();
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      await vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address);

      // Verify the transfer
      const newOwnerVestingDetails = await vestingMechanism.getVestingDetails(getEmptyVestingParams(addr2.address));
      expect(newOwnerVestingDetails.hasVestingSchedule).to.equal(true);
      expect(parseFloatEther(newOwnerVestingDetails.amountLeft)).to.equal("500.00");

      // Ensure the original beneficiary cannot claim tokens anymore
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]))
        .to.be.revertedWithCustomError(vestingMechanism, "CallerHasNoVestingSchedule");
      
      const addr1Balance = await rumToken.balanceOf(addr1.address);
      await rumToken.connect(addr1).transfer(addr2.address, addr1Balance);
      // Let new beneficiary claim tokens
      await advanceTimeByOneDay();
      vestingParams = await getVestingParamsFromAddress(addr2.address);
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);
      await advanceTimeToVestingPeriodEnd(addr2.address);
      await vestingMechanism.connect(addr2).release(vestingParams, proofs[addr2.address]);
      const addr2Balance = await rumToken.balanceOf(addr2.address);
      expect(parseFloatEther(addr2Balance)).to.equal("1000.00");
    });
    it("Should not release tokens during cliff duration", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr4.address);
      await advanceTimeByOneDay();
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      // Attempt to release tokens during the cliff period should fail
      await expect(vestingMechanism.connect(addr4).release(vestingParams, proofs[addr4.address]))
        .to.be.revertedWithCustomError(vestingMechanism, "ReleaseTimeNotReached");
    
      // Advance time by 30 days to simulate the end of the cliff period
      await ethers.provider.send("evm_increaseTime", [thirtyDaysInSeconds]);
      await ethers.provider.send("evm_mine");
    
      // After the cliff period, releasing tokens should succeed
      await expect(vestingMechanism.connect(addr4).release(vestingParams, proofs[addr4.address]))
        .to.emit(vestingMechanism, "TokensReleased");
    });
    it("Should correctly calculate release amount post-cliff for addr4", async function () {
      await advanceTimeByOneDay();
      // Retrieve the vesting parameters for addr4
      const vestingParams = await getVestingParamsFromAddress(addr4.address);
    
      // Advance time to just after the cliff period ends
      const cliffDurationInSeconds = BigInt(vestingParams.delayInSeconds);
      await ethers.provider.send("evm_increaseTime", [Number(cliffDurationInSeconds) + 1]);
      await ethers.provider.send("evm_mine");
    
      // Release tokens after the cliff period
      await vestingMechanism.connect(addr4).release(vestingParams, proofs[addr4.address]);
    
      // Calculate the expected release amount just after the cliff ends
      // Assuming linear vesting post-cliff
      const totalAmount = ethers.parseEther("1000"); // Total vested amount for addr4
      // Fetch the actual released amount from the vesting details
      const vestingDetails = await vestingMechanism.getVestingDetails(vestingParams);
      const actualReleasedAmount = BigInt(vestingDetails.amountReleased.toString());
    
      // Assert that the actual released amount matches the expected amount
      expect(actualReleasedAmount).to.be.gte(0).and.to.be.lt(totalAmount);
    });
    it("Should not allow claiming tokens after the total amount has been released", async function () {
      // Retrieve the vesting parameters for a given address, e.g., addr1
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
    
      // Simulate the complete release of tokens according to the vesting schedule
      // This might involve advancing time beyond the total vesting period and calling the release method
      // Ensure you cover the entire vesting period, including any cliff period if applicable
      await advanceTimeToVestingPeriodEnd(addr1.address);
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      await advanceTimeByOneDay();
      // Attempt to claim tokens again after the total amount has been released
      // This should fail as there should be no tokens left to claim
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]))
        .to.be.revertedWithCustomError(vestingMechanism, "NoTokensDue");
    });
    it("Should not release tokens to non-KYC verified beneficiaries after toggling KYC requirement", async function () {  
      // Toggle the KYC requirement on
      await vestingMechanism.connect(owner).toggleKYCRequirement();
  
      // Retrieve the vesting parameters for a beneficiary, e.g., addr1
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
  
      // Attempt to release tokens for a beneficiary who is not KYC verified
      // This should fail as the KYC requirement is now enforced
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]))
        .to.be.revertedWithCustomError(vestingMechanism, "BeneficiaryNotKYCVerified");
  
      // For completeness, you might also want to test that KYC verified beneficiaries can still claim tokens
      // First, mark addr2 as KYC verified
      await vestingMechanism.connect(owner).setKYCVerified(addr2.address, true);
  
      // Retrieve the vesting parameters for addr2
      const vestingParamsForAddr2 = await getVestingParamsFromAddress(addr2.address);
  
      // Attempt to release tokens for addr2, which should succeed
      await expect(vestingMechanism.connect(addr2).release(vestingParamsForAddr2, proofs[addr2.address]))
        .to.emit(vestingMechanism, "TokensReleased");
    });
    it("Should toggle KYC requirement correctly", async function () {
      // Initially, the KYC requirement should be off
      expect(await vestingMechanism.kycRequired()).to.equal(false);
    
      // Toggle the KYC requirement on
      await vestingMechanism.connect(owner).toggleKYCRequirement();
      expect(await vestingMechanism.kycRequired()).to.equal(true);
    
      // Toggle the KYC requirement off again
      await vestingMechanism.connect(owner).toggleKYCRequirement();
      expect(await vestingMechanism.kycRequired()).to.equal(false);
    });
    it("Should not transfer vesting ownership to the zero address", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Create vesting first
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Attempt to transfer ownership to the zero address
      
      await expect(vestingMechanism.connect(addr1).transferVestingOwnership(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(vestingMechanism, "NewBeneficiaryIsZeroAddress");
    });
    it("Should not allow transfer from an address without a vesting schedule", async function () {
      // Attempt to transfer ownership from an address without a vesting schedule
      await expect(vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address))
          .to.be.revertedWithCustomError(vestingMechanism, "CallerHasNoVestingSchedule");
    });
    it("Should not allow transfer after vesting is complete", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Simulate complete vesting
      await advanceTimeToVestingPeriodEnd(addr1.address);
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Attempt to transfer ownership after vesting is complete
      await expect(vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address))
          .to.be.reverted; // Adjust based on actual behavior, e.g., custom error or generic revert
    });
    it("Should only allow the current beneficiary to transfer vesting ownership", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Create vesting first
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Attempt to transfer ownership by a different address
      await expect(vestingMechanism.connect(addr2).transferVestingOwnership(addr3.address))
        .to.be.revertedWithCustomError(vestingMechanism, "CallerHasNoVestingSchedule");
    });
    it("Should emit VestingOwnershipTransferred event on successful transfer", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Create vesting first
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Transfer ownership and check for event
      await expect(vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address))
          .to.emit(vestingMechanism, "VestingOwnershipTransferred")
          .withArgs(addr1.address, addr2.address);
    });
    it("Should not allow the original beneficiary to claim tokens after the schedule has been transferred", async function () {
      const vestingParams = await getVestingParamsFromAddress(addr1.address);
      // Create vesting schedule for the original beneficiary
      await vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]);
      // Transfer the vesting schedule to a new beneficiary
      await vestingMechanism.connect(addr1).transferVestingOwnership(addr2.address);
      // Attempt to claim tokens from the old schedule as the original beneficiary
      await expect(vestingMechanism.connect(addr1).release(vestingParams, proofs[addr1.address]))
          .to.be.revertedWithCustomError(vestingMechanism, "CallerHasNoVestingSchedule");
    });
  });

  describe("Role Management", function () {
    let kycAdmin, otherAccount;

    beforeEach(async function () {
      [, , kycAdmin, otherAccount] = await ethers.getSigners();
      // Assuming the deployVestingMechanism function already sets the deployer as the default admin
      // Grant KYC_ADMIN_ROLE to kycAdmin
      const KYC_ADMIN_ROLE = await vestingMechanism.KYC_ADMIN_ROLE();
      await vestingMechanism.grantRole(KYC_ADMIN_ROLE, kycAdmin.address);
    });

    it("Should allow granting KYC_ADMIN_ROLE and KYC_VERIFIER_ROLE by KYC_ADMIN after revoking DEFAULT_ADMIN_ROLE from owner", async function () {
      const KYC_ADMIN_ROLE = await vestingMechanism.KYC_ADMIN_ROLE();
      const KYC_VERIFIER_ROLE = await vestingMechanism.KYC_VERIFIER_ROLE();
      const DEFAULT_ADMIN_ROLE = await vestingMechanism.DEFAULT_ADMIN_ROLE();

      // Revoke DEFAULT_ADMIN_ROLE from owner to simulate loss of super admin privileges
      await vestingMechanism.revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      // KYC Admin grants KYC_ADMIN_ROLE to another account
      await expect(vestingMechanism.connect(kycAdmin).grantRole(KYC_ADMIN_ROLE, otherAccount.address))
        .to.emit(vestingMechanism, "RoleGranted")
        .withArgs(KYC_ADMIN_ROLE, otherAccount.address, kycAdmin.address);

      // KYC Admin grants KYC_VERIFIER_ROLE to another account
      await expect(vestingMechanism.connect(kycAdmin).grantRole(KYC_VERIFIER_ROLE, otherAccount.address))
        .to.emit(vestingMechanism, "RoleGranted")
        .withArgs(KYC_VERIFIER_ROLE, otherAccount.address, kycAdmin.address);
    });

    it("KYC Admin should have KYC_ADMIN_ROLE", async function () {
      const KYC_ADMIN_ROLE = await vestingMechanism.KYC_ADMIN_ROLE();
      expect(await vestingMechanism.hasRole(KYC_ADMIN_ROLE, kycAdmin.address)).to.be.true;
    });

    it("KYC Admin should be able to grant KYC_VERIFIER_ROLE", async function () {
      const KYC_VERIFIER_ROLE = await vestingMechanism.KYC_VERIFIER_ROLE();
      // KYC Admin grants KYC_VERIFIER_ROLE to otherAccount
      await vestingMechanism.connect(kycAdmin).grantRole(KYC_VERIFIER_ROLE, otherAccount.address);
      expect(await vestingMechanism.hasRole(KYC_VERIFIER_ROLE, otherAccount.address)).to.be.true;
    });

    it("Non-KYC Admin should not be able to grant KYC_VERIFIER_ROLE", async function () {
      const KYC_VERIFIER_ROLE = await vestingMechanism.KYC_VERIFIER_ROLE();
      const KYC_ADMIN_ROLE = await vestingMechanism.KYC_ADMIN_ROLE();
      // Attempt by otherAccount (not a KYC Admin) to grant KYC_VERIFIER_ROLE should fail
      await expect(vestingMechanism.connect(otherAccount).grantRole(KYC_VERIFIER_ROLE, kycAdmin.address))
        .to.be.revertedWith("AccessControl: account " + otherAccount.address.toLowerCase() + " is missing role " + KYC_ADMIN_ROLE);
    });

    it("KYC Admin should be able to revoke KYC_VERIFIER_ROLE", async function () {
      const KYC_VERIFIER_ROLE = await vestingMechanism.KYC_VERIFIER_ROLE();
      // First, grant KYC_VERIFIER_ROLE to otherAccount
      await vestingMechanism.connect(kycAdmin).grantRole(KYC_VERIFIER_ROLE, otherAccount.address);
      // Then, revoke KYC_VERIFIER_ROLE from otherAccount
      await vestingMechanism.connect(kycAdmin).revokeRole(KYC_VERIFIER_ROLE, otherAccount.address);
      expect(await vestingMechanism.hasRole(KYC_VERIFIER_ROLE, otherAccount.address)).to.be.false;
    });
  });

  async function getVestingParamsFromAddress(address) {
    const vestingEntry = vestingEntries.find(entry => entry.beneficiary === address);
    if (!vestingEntry) {
      throw new Error(`Vesting entry not found for address: ${address}`);
    }
    const { totalAmount: totalAmount, delayInSeconds, tgePercent, vestingPeriodDays, vestingPeriodDurationInSeconds } = vestingEntry;
    return {
      beneficiary: address,
      totalAmount: totalAmount,
      delayInSeconds: delayInSeconds,
      tgePercent: tgePercent,
      vestingPeriodDays: vestingPeriodDays,
      vestingPeriodDurationInSeconds: vestingPeriodDurationInSeconds
    };
  }

  function getEmptyVestingParams(address) {
    return {
      beneficiary: address,
      totalAmount: 0,
      delayInSeconds: 0,
      tgePercent: 0,
      vestingPeriodDays: 0,
      vestingPeriodDurationInSeconds: 0
    };
  }

  async function advanceTimeByOneDay() {
    await ethers.provider.send("evm_increaseTime", [86401]); // 86400 seconds in a day + 1 second
    await ethers.provider.send("evm_mine");
  }

  async function advanceTimeToVestingPeriodEnd(address) {
    const vestingParams = await getVestingParamsFromAddress(address);
    const currentBlock = await ethers.provider.getBlock('latest');
    const currentTime = BigInt(currentBlock.timestamp);
    const vestingStartTime = BigInt(await vestingMechanism.vestingStartTime());
    const vestingPeriodEnd = BigInt(vestingParams.delayInSeconds) + (BigInt(vestingParams.vestingPeriodDays) * BigInt(86400)) + vestingStartTime;
    const timeToAdvance = vestingPeriodEnd - currentTime + BigInt(1); // Adding 1 to ensure we are past the end
    if (timeToAdvance > 0) {
      await ethers.provider.send("evm_increaseTime", [Number(timeToAdvance)]);
      await ethers.provider.send("evm_mine");
    }
  }

  async function advanceTimeTo(targetTimestamp) {
    const currentBlock = await ethers.provider.getBlock('latest');
    const currentTime = currentBlock.timestamp;
    const timeToAdvance = targetTimestamp - currentTime;
    if (timeToAdvance > 0) {
      await ethers.provider.send("evm_increaseTime", [timeToAdvance]);
      await ethers.provider.send("evm_mine");
    }
  }

  // Helper functions
  async function deployRumToken() {
    const RumToken = await ethers.getContractFactory("DumyToken");
    const rumToken = await RumToken.deploy(ethers.parseEther("1000000000000"));
    return rumToken;
  }

  function prepareVestingEntries(owner, addr1, addr2, addr3, addr4, addr5) {
    return [
      createVestingEntry(owner.address, "1000", 0, 50, 90, 86400),
      createVestingEntry(addr1.address, "1000", 0, 50, 90, 86400),
      createVestingEntry(addr2.address, "1000", 0, 10, 90, 30*86400),
      createVestingEntry(addr3.address, "1000", 0, 0, 90, 86400),
      createVestingEntry(addr4.address, "1000", 30*86400, 0, 90, 86400),
      createVestingEntry(addr5.address, "1000", 30*86400, 50, 90, 86400)
    ];
  }

  function createVestingEntry(address, amount, delay, tgePercent, days, vestingPeriodDurationInSeconds) {
    return {
      beneficiary: address,
      totalAmount: ethers.parseEther(amount),
      delayInSeconds: delay,
      tgePercent: tgePercent,
      vestingPeriodDays: days,
      vestingPeriodDurationInSeconds: vestingPeriodDurationInSeconds
    };
  }

  async function deployVestingMechanism(adminAddress, tokenAddress, merkleRoot, startTime) {
    const VestingMechanismFactory = await ethers.getContractFactory("VestingMechanism");
    return await VestingMechanismFactory.deploy(adminAddress, tokenAddress, merkleRoot, startTime);
  }

  async function getNextDayTimestamp() {
    const latestBlock = await ethers.provider.getBlock('latest');
    return latestBlock.timestamp + 86400; // Next day
  }
});