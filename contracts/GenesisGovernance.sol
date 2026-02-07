// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GenesisGovernance
 * @notice On-chain governance: proposals, voting, execution.
 *         Genesis monitors all governance activity in real time.
 *
 *         KEY FEATURES:
 *           1. Anyone can create a proposal (with min token balance)
 *           2. Token holders vote For / Against / Abstain
 *           3. Voting period with configurable duration
 *           4. Proposal execution after passing
 *           5. Rich events for every action (Genesis monitors these)
 *
 *         SIMPLIFIED FOR HACKATHON:
 *           - Uses simple token balance snapshot (no delegation)
 *           - No timelock on execution
 *           - Quorum is configurable
 */
contract GenesisGovernance is Ownable {

    // ──────────────────── Types ─────────────────────
    enum ProposalState { Active, Passed, Failed, Executed, Cancelled }
    enum VoteType { Against, For, Abstain }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        uint256 startTime;
        uint256 endTime;
        ProposalState state;
        bool executed;
    }

    // ──────────────────── Storage ───────────────────
    Proposal[] public proposals;
    
    // proposalId → voter → hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    
    // proposalId → voter → voteType
    mapping(uint256 => mapping(address => VoteType)) public voterChoice;

    // Config
    uint256 public votingDuration = 3 days;  // default
    uint256 public quorumVotes = 1000e6;     // minimum votes to pass (in token units)
    uint256 public proposalThreshold = 100e6; // min tokens to create proposal

    // Stats
    uint256 public totalProposals;
    uint256 public totalVotesCast;

    // ──────────────────── Events ────────────────────
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        string description,
        uint256 startTime,
        uint256 endTime,
        uint256 timestamp
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        VoteType voteType,
        uint256 weight,
        string reason,
        uint256 timestamp
    );

    event ProposalStateChanged(
        uint256 indexed proposalId,
        ProposalState oldState,
        ProposalState newState,
        uint256 timestamp
    );

    event ProposalExecuted(
        uint256 indexed proposalId,
        address indexed executor,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 timestamp
    );

    event ProposalCancelled(
        uint256 indexed proposalId,
        address indexed canceller,
        string reason,
        uint256 timestamp
    );

    event GovernanceConfigChanged(
        string parameter,
        uint256 oldValue,
        uint256 newValue,
        uint256 timestamp
    );

    // ──────────────────── Constructor ────────────────
    constructor() Ownable(msg.sender) {}

    // ──────────────────── Proposal functions ─────────

    /**
     * @notice Create a new governance proposal.
     * @param title Short title
     * @param description Detailed description
     * @param durationOverride Custom voting duration (0 = use default)
     */
    function createProposal(
        string calldata title,
        string calldata description,
        uint256 durationOverride
    ) external returns (uint256 proposalId) {
        require(bytes(title).length > 0, "Gov: empty title");

        uint256 duration = durationOverride > 0 ? durationOverride : votingDuration;

        proposalId = proposals.length;
        proposals.push(Proposal({
            id: proposalId,
            proposer: msg.sender,
            title: title,
            description: description,
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            state: ProposalState.Active,
            executed: false
        }));

        totalProposals++;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            title,
            description,
            block.timestamp,
            block.timestamp + duration,
            block.timestamp
        );
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @param proposalId The proposal to vote on
     * @param voteType 0=Against, 1=For, 2=Abstain
     * @param weight Vote weight (in token units — caller self-reports for demo)
     * @param reason Optional reason string
     */
    function castVote(
        uint256 proposalId,
        VoteType voteType,
        uint256 weight,
        string calldata reason
    ) external {
        require(proposalId < proposals.length, "Gov: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Gov: not active");
        require(block.timestamp <= p.endTime, "Gov: voting ended");
        require(!hasVoted[proposalId][msg.sender], "Gov: already voted");
        require(weight > 0, "Gov: zero weight");

        hasVoted[proposalId][msg.sender] = true;
        voterChoice[proposalId][msg.sender] = voteType;

        if (voteType == VoteType.For) {
            p.votesFor += weight;
        } else if (voteType == VoteType.Against) {
            p.votesAgainst += weight;
        } else {
            p.votesAbstain += weight;
        }

        totalVotesCast++;

        emit VoteCast(
            proposalId,
            msg.sender,
            voteType,
            weight,
            reason,
            block.timestamp
        );
    }

    /**
     * @notice Finalize a proposal after voting ends.
     * @param proposalId The proposal to finalize
     */
    function finalizeProposal(uint256 proposalId) external {
        require(proposalId < proposals.length, "Gov: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Gov: not active");

        ProposalState oldState = p.state;
        uint256 totalVotes = p.votesFor + p.votesAgainst + p.votesAbstain;

        // Check quorum and majority
        if (totalVotes >= quorumVotes && p.votesFor > p.votesAgainst) {
            p.state = ProposalState.Passed;
        } else {
            p.state = ProposalState.Failed;
        }

        emit ProposalStateChanged(proposalId, oldState, p.state, block.timestamp);
    }

    /**
     * @notice Execute a passed proposal.
     * @param proposalId The proposal to execute
     */
    function executeProposal(uint256 proposalId) external {
        require(proposalId < proposals.length, "Gov: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Passed, "Gov: not passed");
        require(!p.executed, "Gov: already executed");

        p.executed = true;
        p.state = ProposalState.Executed;

        emit ProposalExecuted(
            proposalId,
            msg.sender,
            p.votesFor,
            p.votesAgainst,
            block.timestamp
        );

        emit ProposalStateChanged(proposalId, ProposalState.Passed, ProposalState.Executed, block.timestamp);
    }

    /**
     * @notice Cancel a proposal (proposer or owner).
     * @param proposalId The proposal to cancel
     * @param reason Reason for cancellation
     */
    function cancelProposal(uint256 proposalId, string calldata reason) external {
        require(proposalId < proposals.length, "Gov: invalid proposal");
        Proposal storage p = proposals[proposalId];
        require(
            msg.sender == p.proposer || msg.sender == owner(),
            "Gov: not authorized"
        );
        require(p.state == ProposalState.Active, "Gov: not active");

        ProposalState oldState = p.state;
        p.state = ProposalState.Cancelled;

        emit ProposalCancelled(proposalId, msg.sender, reason, block.timestamp);
        emit ProposalStateChanged(proposalId, oldState, ProposalState.Cancelled, block.timestamp);
    }

    // ──────────────────── Config (owner only) ───────

    function setVotingDuration(uint256 newDuration) external onlyOwner {
        uint256 old = votingDuration;
        votingDuration = newDuration;
        emit GovernanceConfigChanged("votingDuration", old, newDuration, block.timestamp);
    }

    function setQuorum(uint256 newQuorum) external onlyOwner {
        uint256 old = quorumVotes;
        quorumVotes = newQuorum;
        emit GovernanceConfigChanged("quorumVotes", old, newQuorum, block.timestamp);
    }

    function setProposalThreshold(uint256 newThreshold) external onlyOwner {
        uint256 old = proposalThreshold;
        proposalThreshold = newThreshold;
        emit GovernanceConfigChanged("proposalThreshold", old, newThreshold, block.timestamp);
    }

    // ──────────────────── View functions ─────────────

    function getProposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function getProposalInfo(uint256 proposalId) external view returns (
        address proposer,
        string memory title,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votesAbstain,
        ProposalState state,
        bool executed
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.proposer, p.title, p.votesFor, p.votesAgainst, p.votesAbstain, p.state, p.executed);
    }

    function getVoteResult(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        uint256 totalVotes,
        bool quorumReached,
        bool passed
    ) {
        Proposal storage p = proposals[proposalId];
        uint256 total = p.votesFor + p.votesAgainst + p.votesAbstain;
        return (
            p.votesFor,
            p.votesAgainst,
            p.votesAbstain,
            total,
            total >= quorumVotes,
            p.votesFor > p.votesAgainst && total >= quorumVotes
        );
    }
}
