#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source, default_alloc, entry, error::SysError, high_level::load_cell_data,
};

default_alloc!();
entry!(program_entry);

const FLAG_ISSUED: u8 = 0x01;
const FLAG_REVOKED: u8 = 0x02;

const OFFSET_FLAG: usize = 0;
const OFFSET_CONTENT_HASH: usize = 1;
const OFFSET_CKBFS_POINTER: usize = OFFSET_CONTENT_HASH + 32;
const OFFSET_ISSUER_LOCK_ARG: usize = OFFSET_CKBFS_POINTER + 32;
const OFFSET_RECIPIENT_LOCK_ARG: usize = OFFSET_ISSUER_LOCK_ARG + 20;
const OFFSET_ISSUED_AT: usize = OFFSET_RECIPIENT_LOCK_ARG + 20;
const OFFSET_VERIFICATION_LEN: usize = OFFSET_ISSUED_AT + 8;
const OFFSET_HAS_EXPIRY: usize = OFFSET_VERIFICATION_LEN + 2;
const HEADER_SIZE: usize = OFFSET_HAS_EXPIRY + 1;

#[repr(i8)]
enum Error {
    UnknownAction = 100,
    IssueMissingIssuedFlag = 11,
    InvalidContentHash = 12,
    InvalidCkbfsPointer = 13,
    InvalidIssuer = 14,
    InvalidRecipient = 15,
    InvalidDataLength = 16,
    InvalidExpiryFlag = 17,
    TransferFromRevokedCredential = 20,
    AlreadyRevoked = 21,
    InvalidMutation = 22,
    SysError = 110,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CredentialAction {
    Issue,
    Transfer,
    Revoke,
}

fn program_entry() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(err) => err as i8,
    }
}

fn run() -> Result<(), Error> {
    let input_data = load_group_data(Source::GroupInput)?;
    let output_data = load_group_data(Source::GroupOutput)?;

    let action = detect_action(input_data.as_deref(), output_data.as_deref())?;

    match action {
        CredentialAction::Issue => validate_issue(output_data.as_deref().unwrap_or(&[])),
        CredentialAction::Transfer => {
            let input = input_data.as_deref().unwrap_or(&[]);
            let output = output_data.as_deref().unwrap_or(&[]);

            let input_flag = input[OFFSET_FLAG];
            if (input_flag & FLAG_REVOKED) != 0 {
                return Err(Error::TransferFromRevokedCredential);
            }

            validate_format(input)?;
            validate_format(output)?;

            if input[OFFSET_CONTENT_HASH..] != output[OFFSET_CONTENT_HASH..] {
                return Err(Error::InvalidMutation);
            }

            Ok(())
        }
        CredentialAction::Revoke => {
            let input = input_data.as_deref().unwrap_or(&[]);
            let output = output_data.as_deref().unwrap_or(&[]);

            validate_format(input)?;
            validate_format(output)?;

            let input_flag = input[OFFSET_FLAG];
            if (input_flag & FLAG_REVOKED) != 0 {
                return Err(Error::AlreadyRevoked);
            }

            let expected_flag = input_flag | FLAG_REVOKED;
            if output[OFFSET_FLAG] != expected_flag {
                return Err(Error::InvalidMutation);
            }

            if input[OFFSET_CONTENT_HASH..] != output[OFFSET_CONTENT_HASH..] {
                return Err(Error::InvalidMutation);
            }

            Ok(())
        }
    }
}

fn detect_action(input: Option<&[u8]>, output: Option<&[u8]>) -> Result<CredentialAction, Error> {
    match (input, output) {
        (None, Some(_)) => Ok(CredentialAction::Issue),
        (Some(input_data), Some(output_data)) => {
            let input_flag = input_data.first().copied().unwrap_or(0);
            let output_flag = output_data.first().copied().unwrap_or(0);

            if (output_flag & FLAG_REVOKED) != 0 && (input_flag & FLAG_REVOKED) == 0 {
                Ok(CredentialAction::Revoke)
            } else {
                Ok(CredentialAction::Transfer)
            }
        }
        _ => Err(Error::UnknownAction),
    }
}

fn validate_issue(output_data: &[u8]) -> Result<(), Error> {
    validate_format(output_data)?;

    let flag = output_data[OFFSET_FLAG];
    if (flag & FLAG_ISSUED) == 0 {
        return Err(Error::IssueMissingIssuedFlag);
    }

    if (flag & FLAG_REVOKED) != 0 {
        return Err(Error::AlreadyRevoked);
    }

    Ok(())
}

fn validate_format(data: &[u8]) -> Result<(), Error> {
    if data.len() < HEADER_SIZE {
        return Err(Error::InvalidDataLength);
    }

    if is_all_zero(&data[OFFSET_CONTENT_HASH..OFFSET_CONTENT_HASH + 32]) {
        return Err(Error::InvalidContentHash);
    }

    if is_all_zero(&data[OFFSET_CKBFS_POINTER..OFFSET_CKBFS_POINTER + 32]) {
        return Err(Error::InvalidCkbfsPointer);
    }

    if is_all_zero(&data[OFFSET_ISSUER_LOCK_ARG..OFFSET_ISSUER_LOCK_ARG + 20]) {
        return Err(Error::InvalidIssuer);
    }

    if is_all_zero(&data[OFFSET_RECIPIENT_LOCK_ARG..OFFSET_RECIPIENT_LOCK_ARG + 20]) {
        return Err(Error::InvalidRecipient);
    }

    let verification_len = u16::from_le_bytes([
        data[OFFSET_VERIFICATION_LEN],
        data[OFFSET_VERIFICATION_LEN + 1],
    ]) as usize;
    let has_expiry = data[OFFSET_HAS_EXPIRY];

    if has_expiry != 0 && has_expiry != 1 {
        return Err(Error::InvalidExpiryFlag);
    }

    let expected_len = HEADER_SIZE + verification_len + if has_expiry == 1 { 8 } else { 0 };
    if data.len() != expected_len {
        return Err(Error::InvalidDataLength);
    }

    Ok(())
}

fn is_all_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| b == 0)
}

fn load_group_data(source: Source) -> Result<Option<alloc::vec::Vec<u8>>, Error> {
    match load_cell_data(0, source) {
        Ok(data) => Ok(Some(data)),
        Err(SysError::IndexOutOfBound) => Ok(None),
        Err(_) => Err(Error::SysError),
    }
}
