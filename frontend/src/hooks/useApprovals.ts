import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { CONTRACT_ADDRESSES } from '@/lib/web3'
import { API_BASE } from '@/lib/apiBase'

export interface ApprovalStatus {
  usdfApproved: boolean
  ctfApproved: boolean
  isLoading: boolean
  error: string | null
}

export interface ApprovalActions {
  approveUSDF: () => Promise<void>
  approveCTF: () => Promise<void>
  checkApprovals: () => Promise<void>
}

export function useApprovals(): [ApprovalStatus, ApprovalActions] {
  const { address } = useAccount()
  const [status, setStatus] = useState<ApprovalStatus>({
    usdfApproved: false,
    ctfApproved: false,
    isLoading: false,
    error: null
  })

  // USDF approval
  const { writeContract: writeUSDFApproval, data: usdfApprovalHash } = useWriteContract()
  const { isLoading: isUSDFApprovalLoading } = useWaitForTransactionReceipt({
    hash: usdfApprovalHash,
  })

  // CTF approval
  const { writeContract: writeCTFApproval, data: ctfApprovalHash } = useWriteContract()
  const { isLoading: isCTFApprovalLoading } = useWaitForTransactionReceipt({
    hash: ctfApprovalHash,
  })

  const checkApprovals = async () => {
    if (!address) return

    setStatus(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // Check USDF allowance
      const usdfAllowance = await fetch(`${API_BASE}/api/allowance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress: CONTRACT_ADDRESSES.usdf,
          owner: address,
          spender: CONTRACT_ADDRESSES.exchange
        })
      }).then(res => res.json())

      // Check CTF approval
      const ctfApproved = await fetch(`${API_BASE}/api/isApprovedForAll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: CONTRACT_ADDRESSES.conditionalTokens,
          owner: address,
          operator: CONTRACT_ADDRESSES.exchange
        })
      }).then(res => res.json())

      setStatus({
        usdfApproved: usdfAllowance.allowance > 0,
        ctfApproved: ctfApproved.approved,
        isLoading: false,
        error: null
      })
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check approvals'
      }))
    }
  }

  const approveUSDF = async () => {
    if (!address) throw new Error('No wallet connected')

    try {
      await writeUSDFApproval({
        address: CONTRACT_ADDRESSES.usdf,
        abi: [
          {
            inputs: [
              { name: 'spender', type: 'address' },
              { name: 'amount', type: 'uint256' }
            ],
            name: 'approve',
            outputs: [{ type: 'bool' }],
            stateMutability: 'nonpayable',
            type: 'function'
          }
        ],
        functionName: 'approve',
        args: [CONTRACT_ADDRESSES.exchange, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')]
      })

      // Wait for confirmation and recheck
      await checkApprovals()
    } catch (error) {
      throw new Error(`Failed to approve USDF: ${error}`)
    }
  }

  const approveCTF = async () => {
    if (!address) throw new Error('No wallet connected')

    try {
      await writeCTFApproval({
        address: CONTRACT_ADDRESSES.conditionalTokens,
        abi: [
          {
            inputs: [
              { name: 'operator', type: 'address' },
              { name: 'approved', type: 'bool' }
            ],
            name: 'setApprovalForAll',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function'
          }
        ],
        functionName: 'setApprovalForAll',
        args: [CONTRACT_ADDRESSES.exchange, true]
      })

      // Wait for confirmation and recheck
      await checkApprovals()
    } catch (error) {
      throw new Error(`Failed to approve CTF: ${error}`)
    }
  }

  return [
    {
      ...status,
      isLoading: isUSDFApprovalLoading || isCTFApprovalLoading || status.isLoading
    },
    {
      approveUSDF,
      approveCTF,
      checkApprovals
    }
  ]
}
