// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title AthenaPool - Multi-Case Donation Pool
 * @dev Single contract that manages multiple "sub-pools" by caseId
 * 
 * How it works:
 * 1. Agent creates a case with createCase(caseId, ownerAddress, safeContact)
 * 2. Donors send ETH with donate(caseId)
 * 3. Case owner can withdraw their funds
 * 4. SOS triggers transfer to safe contact
 * 
 * Deployed on: Fraxtal Testnet (Chain ID: 2523)
 */
contract AthenaPool {
    
    // Pool admin (Athena platform)
    address public admin;
    
    // Case structure
    struct Case {
        address owner;           // The victim/person in need
        address safeContact;     // Emergency contact for SOS
        uint256 balance;         // Total funds for this case
        uint256 totalDonations;  // Running total of all donations
        uint256 donorCount;      // Number of unique donors
        bool isActive;           // Can receive donations
        bool exists;             // Case exists
        uint256 createdAt;       // Timestamp
    }
    
    // Mappings
    mapping(string => Case) public cases;
    mapping(string => mapping(address => uint256)) public donations; // caseId => donor => amount
    
    // Events
    event CaseCreated(string indexed caseId, address owner, address safeContact, uint256 timestamp);
    event DonationReceived(string indexed caseId, address indexed donor, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(string indexed caseId, address indexed to, uint256 amount);
    event SOSTriggered(string indexed caseId, address indexed safeContact, uint256 amount);
    event SafeContactUpdated(string indexed caseId, address newContact);
    event CaseDeactivated(string indexed caseId);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier caseExists(string memory caseId) {
        require(cases[caseId].exists, "Case does not exist");
        _;
    }
    
    modifier onlyCaseOwner(string memory caseId) {
        require(cases[caseId].owner == msg.sender || admin == msg.sender, "Not case owner");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    /**
     * @dev Create a new case (called by Athena agent)
     * @param caseId Unique case identifier (e.g., "ATHENA-1702123456-ABCD")
     * @param owner Address of the person in need
     * @param safeContact Address for emergency transfers
     */
    function createCase(
        string memory caseId, 
        address owner, 
        address safeContact
    ) external onlyAdmin {
        require(!cases[caseId].exists, "Case already exists");
        require(owner != address(0), "Invalid owner");
        
        cases[caseId] = Case({
            owner: owner,
            safeContact: safeContact,
            balance: 0,
            totalDonations: 0,
            donorCount: 0,
            isActive: true,
            exists: true,
            createdAt: block.timestamp
        });
        
        emit CaseCreated(caseId, owner, safeContact, block.timestamp);
    }
    
    /**
     * @dev Donate to a specific case
     * @param caseId Case to donate to
     */
    function donate(string memory caseId) external payable caseExists(caseId) {
        require(cases[caseId].isActive, "Case is not active");
        require(msg.value > 0, "Donation must be > 0");
        
        Case storage c = cases[caseId];
        
        // Track unique donors
        if (donations[caseId][msg.sender] == 0) {
            c.donorCount++;
        }
        
        donations[caseId][msg.sender] += msg.value;
        c.balance += msg.value;
        c.totalDonations += msg.value;
        
        emit DonationReceived(caseId, msg.sender, msg.value, block.timestamp);
    }
    
    /**
     * @dev Withdraw funds (only case owner)
     * @param caseId Case to withdraw from
     * @param amount Amount to withdraw
     */
    function withdraw(
        string memory caseId, 
        uint256 amount
    ) external caseExists(caseId) onlyCaseOwner(caseId) {
        Case storage c = cases[caseId];
        require(amount <= c.balance, "Insufficient balance");
        
        c.balance -= amount;
        payable(c.owner).transfer(amount);
        
        emit FundsWithdrawn(caseId, c.owner, amount);
    }
    
    /**
     * @dev Emergency SOS - Transfer ALL funds to safe contact
     * @param caseId Case to trigger SOS for
     */
    function triggerSOS(string memory caseId) external caseExists(caseId) onlyCaseOwner(caseId) {
        Case storage c = cases[caseId];
        require(c.safeContact != address(0), "No safe contact set");
        require(c.balance > 0, "No funds to transfer");
        
        uint256 amount = c.balance;
        c.balance = 0;
        c.isActive = false;
        
        payable(c.safeContact).transfer(amount);
        
        emit SOSTriggered(caseId, c.safeContact, amount);
        emit CaseDeactivated(caseId);
    }
    
    /**
     * @dev Update safe contact
     */
    function setSafeContact(
        string memory caseId, 
        address newContact
    ) external caseExists(caseId) onlyCaseOwner(caseId) {
        require(newContact != address(0), "Invalid address");
        cases[caseId].safeContact = newContact;
        emit SafeContactUpdated(caseId, newContact);
    }
    
    /**
     * @dev Get case info
     */
    function getCaseInfo(string memory caseId) external view caseExists(caseId) returns (
        address owner,
        address safeContact,
        uint256 balance,
        uint256 totalDonations,
        uint256 donorCount,
        bool isActive,
        uint256 createdAt
    ) {
        Case storage c = cases[caseId];
        return (
            c.owner,
            c.safeContact,
            c.balance,
            c.totalDonations,
            c.donorCount,
            c.isActive,
            c.createdAt
        );
    }
    
    /**
     * @dev Get case balance
     */
    function getCaseBalance(string memory caseId) external view caseExists(caseId) returns (uint256) {
        return cases[caseId].balance;
    }
    
    /**
     * @dev Check if case exists
     */
    function caseExistsCheck(string memory caseId) external view returns (bool) {
        return cases[caseId].exists;
    }
    
    /**
     * @dev Get donation amount for a donor
     */
    function getDonation(string memory caseId, address donor) external view returns (uint256) {
        return donations[caseId][donor];
    }
    
    /**
     * @dev Admin can update case owner (in case of wallet loss)
     */
    function updateCaseOwner(
        string memory caseId, 
        address newOwner
    ) external onlyAdmin caseExists(caseId) {
        require(newOwner != address(0), "Invalid owner");
        cases[caseId].owner = newOwner;
    }
    
    /**
     * @dev Receive ETH directly (goes to admin for platform costs)
     */
    receive() external payable {}
}
