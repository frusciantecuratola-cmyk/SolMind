use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("SoLMiNDvau1TxQRkABCxyzDEFghi1234567890abcd");

#[program]
pub mod solmind {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_name: String,
        risk_tolerance: u8,
    ) -> Result<()> {
        require!(risk_tolerance <= 100, SolMindError::InvalidRiskTolerance);
        require!(vault_name.len() <= 32, SolMindError::NameTooLong);

        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.vault_name = vault_name;
        vault.risk_tolerance = risk_tolerance;
        vault.total_value_lamports = 0;
        vault.rebalance_count = 0;
        vault.last_rebalance_ts = Clock::get()?.unix_timestamp;
        vault.bump = ctx.bumps.vault;

        vault.allocations = [0u16; 8];
        vault.protocol_keys = [Pubkey::default(); 8];
        vault.protocol_count = 0;

        emit!(VaultInitialized {
            vault: vault.key(),
            authority: vault.authority,
            risk_tolerance,
        });

        Ok(())
    }

    pub fn ai_rebalance(
        ctx: Context<AiRebalance>,
        new_allocations: Vec<u16>,
        decision_hash: [u8; 32],
        confidence_score: u8,
        reasoning_uri: String,
        market_signal: i64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        require!(
            ctx.accounts.ai_agent.key() == vault.authority
                || ctx.accounts.ai_agent.key() == vault.ai_agent_pubkey,
            SolMindError::UnauthorizedAgent
        );

        let total: u32 = new_allocations.iter().map(|&x| x as u32).sum();
        require!(total == 10000, SolMindError::AllocationMismatch);
        require!(new_allocations.len() == vault.protocol_count as usize, SolMindError::ProtocolCountMismatch);
        require!(confidence_score >= vault.min_confidence, SolMindError::InsufficientConfidence);

        let max_single_alloc = (vault.risk_tolerance as u16 + 20) * 100;
        for &alloc in &new_allocations {
            require!(alloc <= max_single_alloc, SolMindError::RiskToleranceViolation);
        }

        let old_allocations = vault.allocations;

        for (i, &alloc) in new_allocations.iter().enumerate() {
            vault.allocations[i] = alloc;
        }

        vault.last_decision_hash = decision_hash;
        vault.last_confidence = confidence_score;
        vault.last_market_signal = market_signal;
        vault.last_rebalance_ts = Clock::get()?.unix_timestamp;
        vault.rebalance_count += 1;
        vault.last_reasoning_uri = reasoning_uri.clone();

        emit!(AiDecisionExecuted {
            vault: vault.key(),
            decision_hash,
            confidence_score,
            market_signal,
            rebalance_count: vault.rebalance_count,
            old_allocations: old_allocations[..vault.protocol_count as usize].to_vec(),
            new_allocations: new_allocations.clone(),
            reasoning_uri,
            timestamp: vault.last_rebalance_ts,
        });

        Ok(())
    }

    pub fn register_protocol(
        ctx: Context<RegisterProtocol>,
        protocol_name: String,
        protocol_type: u8,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            ctx.accounts.authority.key() == vault.authority,
            SolMindError::UnauthorizedAgent
        );
        require!(vault.protocol_count < 8, SolMindError::TooManyProtocols);

        let idx = vault.protocol_count as usize;
        vault.protocol_keys[idx] = ctx.accounts.protocol.key();
        vault.protocol_count += 1;

        emit!(ProtocolRegistered {
            vault: vault.key(),
            protocol: ctx.accounts.protocol.key(),
            protocol_name,
            protocol_type,
        });

        Ok(())
    }

    pub fn set_ai_agent(
        ctx: Context<SetAiAgent>,
        new_agent: Pubkey,
        min_confidence: u8,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            ctx.accounts.authority.key() == vault.authority,
            SolMindError::UnauthorizedAgent
        );
        vault.ai_agent_pubkey = new_agent;
        vault.min_confidence = min_confidence;

        emit!(AgentUpdated {
            vault: vault.key(),
            new_agent,
            min_confidence,
        });

        Ok(())
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>, reason: String) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            ctx.accounts.authority.key() == vault.authority,
            SolMindError::UnauthorizedAgent
        );
        vault.paused = true;

        emit!(VaultPaused {
            vault: vault.key(),
            reason,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn record_observation(
        ctx: Context<RecordObservation>,
        observation_hash: [u8; 32],
        observation_type: u8,
        value: i64,
        source_uri: String,
    ) -> Result<()> {
        let record = &mut ctx.accounts.observation_record;
        record.vault = ctx.accounts.vault.key();
        record.observation_hash = observation_hash;
        record.observation_type = observation_type;
        record.value = value;
        record.source_uri = source_uri.clone();
        record.timestamp = Clock::get()?.unix_timestamp;
        record.recorder = ctx.accounts.ai_agent.key();

        emit!(ObservationRecorded {
            vault: ctx.accounts.vault.key(),
            observation_hash,
            observation_type,
            value,
            source_uri,
            timestamp: record.timestamp,
        });

        Ok(())
    }
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub ai_agent_pubkey: Pubkey,
    pub vault_name: String,
    pub risk_tolerance: u8,
    pub min_confidence: u8,
    pub total_value_lamports: u64,
    pub rebalance_count: u64,
    pub last_rebalance_ts: i64,
    pub last_decision_hash: [u8; 32],
    pub last_confidence: u8,
    pub last_market_signal: i64,
    pub last_reasoning_uri: String,
    pub allocations: [u16; 8],
    pub protocol_keys: [Pubkey; 8],
    pub protocol_count: u8,
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct ObservationRecord {
    pub vault: Pubkey,
    pub observation_hash: [u8; 32],
    pub observation_type: u8,
    pub value: i64,
    pub source_uri: String,
    pub timestamp: i64,
    pub recorder: Pubkey,
}

#[derive(Accounts)]
#[instruction(vault_name: String)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 36 + 1 + 1 + 8 + 8 + 8 + 32 + 1 + 8 + 204 + 16 + 256 + 1 + 1 + 1,
        seeds = [b"vault", authority.key().as_ref(), vault_name.as_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AiRebalance<'info> {
    #[account(mut, constraint = !vault.paused @ SolMindError::VaultPaused)]
    pub vault: Account<'info, Vault>,
    pub ai_agent: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterProtocol<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
    /// CHECK: Protocol account
    pub protocol: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetAiAgent<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordObservation<'info> {
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = ai_agent,
        space = 8 + 32 + 32 + 1 + 8 + 204 + 8 + 32,
    )]
    pub observation_record: Account<'info, ObservationRecord>,
    #[account(mut)]
    pub ai_agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub risk_tolerance: u8,
}

#[event]
pub struct AiDecisionExecuted {
    pub vault: Pubkey,
    pub decision_hash: [u8; 32],
    pub confidence_score: u8,
    pub market_signal: i64,
    pub rebalance_count: u64,
    pub old_allocations: Vec<u16>,
    pub new_allocations: Vec<u16>,
    pub reasoning_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolRegistered {
    pub vault: Pubkey,
    pub protocol: Pubkey,
    pub protocol_name: String,
    pub protocol_type: u8,
}

#[event]
pub struct AgentUpdated {
    pub vault: Pubkey,
    pub new_agent: Pubkey,
    pub min_confidence: u8,
}

#[event]
pub struct VaultPaused {
    pub vault: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct ObservationRecorded {
    pub vault: Pubkey,
    pub observation_hash: [u8; 32],
    pub observation_type: u8,
    pub value: i64,
    pub source_uri: String,
    pub timestamp: i64,
}

#[error_code]
pub enum SolMindError {
    #[msg("Risk tolerance must be between 0 and 100")]
    InvalidRiskTolerance,
    #[msg("Vault name exceeds 32 characters")]
    NameTooLong,
    #[msg("Caller is not authorized as AI agent or authority")]
    UnauthorizedAgent,
    #[msg("Allocations must sum to 10000 basis points (100%)")]
    AllocationMismatch,
    #[msg("Protocol count does not match registered protocols")]
    ProtocolCountMismatch,
    #[msg("AI confidence below minimum threshold")]
    InsufficientConfidence,
    #[msg("Single allocation exceeds risk tolerance limit")]
    RiskToleranceViolation,
    #[msg("Maximum 8 protocols per vault")]
    TooManyProtocols,
    #[msg("Vault is paused by authority")]
    VaultPaused,
}