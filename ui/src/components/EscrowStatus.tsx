import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import {
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  RefreshCw,
  Shield,
  DollarSign,
  User,
  Calendar,
  Loader2,
} from 'lucide-react';
import { StellarCrossBorderSDK } from '@stellar-cross-border/sdk';
import { PaymentStatus, EscrowStatus } from '@stellar-cross-border/sdk';
import { format } from 'date-fns';

interface EscrowStatusProps {
  sdk: StellarCrossBorderSDK;
  escrowId: string;
  onStatusChange?: (status: PaymentStatus) => void;
  showActions?: boolean;
}

export const EscrowStatusComponent: React.FC<EscrowStatusProps> = ({
  sdk,
  escrowId,
  onStatusChange,
  showActions = true,
}) => {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const status = await sdk.paymentsInstance.getPaymentStatus(escrowId);
      setPaymentStatus(status);
      setError(null);
      onStatusChange?.(status);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch escrow status';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    const interval = setInterval(() => {
      if (paymentStatus?.status === EscrowStatus.Pending) {
        fetchStatus();
      }
    }, 30000); // Refresh every 30 seconds for pending escrows

    return () => clearInterval(interval);
  }, [escrowId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
  };

  const getStatusIcon = (status: EscrowStatus) => {
    switch (status) {
      case EscrowStatus.Pending:
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case EscrowStatus.Completed:
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case EscrowStatus.Refunded:
        return <XCircle className="w-5 h-5 text-red-500" />;
      case EscrowStatus.Disputed:
        return <AlertCircle className="w-5 h-5 text-orange-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: EscrowStatus) => {
    switch (status) {
      case EscrowStatus.Pending:
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case EscrowStatus.Completed:
        return 'bg-green-100 text-green-800 border-green-200';
      case EscrowStatus.Refunded:
        return 'bg-red-100 text-red-800 border-red-200';
      case EscrowStatus.Disputed:
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    });
  };

  const getTimeRemaining = (releaseTime: number) => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = releaseTime - now;
    
    if (remaining <= 0) {
      return 'Available for release';
    }
    
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days} day${days > 1 ? 's' : ''} ${hours % 24}h remaining`;
    }
    
    return `${hours}h ${minutes}m remaining`;
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">Loading escrow status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center space-x-2 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={handleRefresh}
          className="mt-4 text-blue-600 hover:text-blue-700 flex items-center space-x-1"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (!paymentStatus) {
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Escrow Status</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center space-x-1 text-gray-600 hover:text-gray-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="mb-6">
        <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full border ${getStatusColor(paymentStatus.status)}`}>
          {getStatusIcon(paymentStatus.status)}
          <span className="font-medium capitalize">{paymentStatus.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <DollarSign className="w-4 h-4" />
              <span>Amount</span>
            </div>
            <p className="text-lg font-semibold text-gray-900">
              {formatAmount(paymentStatus.amount)}
            </p>
          </div>

          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <User className="w-4 h-4" />
              <span>Sender</span>
            </div>
            <p className="font-mono text-sm text-gray-900">
              {formatAddress(paymentStatus.sender)}
            </p>
          </div>

          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <User className="w-4 h-4" />
              <span>Receiver</span>
            </div>
            <p className="font-mono text-sm text-gray-900">
              {formatAddress(paymentStatus.receiver)}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <Calendar className="w-4 h-4" />
              <span>Created</span>
            </div>
            <p className="text-sm text-gray-900">
              {format(new Date(paymentStatus.created_at * 1000), 'MMM dd, yyyy HH:mm')}
            </p>
          </div>

          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <Clock className="w-4 h-4" />
              <span>Release Time</span>
            </div>
            <p className="text-sm text-gray-900">
              {format(new Date(paymentStatus.release_time * 1000), 'MMM dd, yyyy HH:mm')}
            </p>
            {paymentStatus.status === EscrowStatus.Pending && (
              <p className="text-xs text-blue-600 mt-1">
                {getTimeRemaining(paymentStatus.release_time)}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
              <Shield className="w-4 h-4" />
              <span>Escrow ID</span>
            </div>
            <p className="font-mono text-xs text-gray-900 break-all">
              {paymentStatus.escrowId}
            </p>
          </div>
        </div>
      </div>

      {paymentStatus.status === EscrowStatus.Pending && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-2">
            <Clock className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Time-Locked Escrow</p>
              <p>
                This payment is protected by a time-locked escrow. The funds will be 
                available for release at the specified time, or can be refunded 
                by the sender at any time.
              </p>
            </div>
          </div>
        </div>
      )}

      {showActions && paymentStatus.status === EscrowStatus.Pending && (
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Available Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paymentStatus.can_release && (
              <button
                onClick={() => {
                  toast.success('Release functionality would be implemented here');
                }}
                className="bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors duration-200 flex items-center justify-center space-x-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Release Funds</span>
              </button>
            )}
            
            {paymentStatus.can_refund && (
              <button
                onClick={() => {
                  toast.success('Refund functionality would be implemented here');
                }}
                className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors duration-200 flex items-center justify-center space-x-2"
              >
                <XCircle className="w-4 h-4" />
                <span>Refund Payment</span>
              </button>
            )}
            
            <button
              onClick={() => {
                toast.success('Dispute functionality would be implemented here');
              }}
              className="bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 transition-colors duration-200 flex items-center justify-center space-x-2"
            >
              <AlertCircle className="w-4 h-4" />
              <span>Open Dispute</span>
            </button>
          </div>
        </div>
      )}

      {paymentStatus.status === EscrowStatus.Disputed && (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
            <div className="text-sm text-orange-800">
              <p className="font-medium mb-1">Payment Under Review</p>
              <p>
                This payment has been disputed and is currently under review. 
                The dispute resolution process will determine the outcome.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
