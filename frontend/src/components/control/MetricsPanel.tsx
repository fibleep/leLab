
import React, { useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Camera, MicOff } from 'lucide-react';

interface MetricsPanelProps {
  activeTab: 'SENSORS' | 'MOTORS';
  setActiveTab: (tab: 'SENSORS' | 'MOTORS') => void;
  sensorData: any[];
  motorData: any[];
  hasPermissions: boolean;
  streamRef: React.RefObject<MediaStream | null>;
  isVoiceActive: boolean;
  micLevel: number;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({
  activeTab,
  setActiveTab,
  sensorData,
  motorData,
  hasPermissions,
  streamRef,
  isVoiceActive,
  micLevel,
}) => {
  const sensorVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (activeTab === 'SENSORS' && hasPermissions && sensorVideoRef.current && streamRef.current) {
      if (sensorVideoRef.current.srcObject !== streamRef.current) {
        sensorVideoRef.current.srcObject = streamRef.current;
      }
    }
  }, [activeTab, hasPermissions, streamRef]);

  return (
    <div className="w-full lg:w-1/2 p-2 sm:p-4">
      <div className="bg-elevated border border-line rounded-panel p-4 h-full flex flex-col">
        {/* Tab Headers */}
        <div className="flex mb-4">
          <button
            onClick={() => setActiveTab('MOTORS')}
            className={`px-6 py-2 rounded-t-panel font-mono text-xs uppercase tracking-[0.1em] transition-colors ${
              activeTab === 'MOTORS'
                ? 'bg-brand text-surface'
                : 'bg-subtle text-ink-2 hover:text-ink'
            }`}
          >
            MOTORS
          </button>
          <button
            onClick={() => setActiveTab('SENSORS')}
            className={`px-6 py-2 rounded-t-panel ml-2 font-mono text-xs uppercase tracking-[0.1em] transition-colors ${
              activeTab === 'SENSORS'
                ? 'bg-brand text-surface'
                : 'bg-subtle text-ink-2 hover:text-ink'
            }`}
          >
            SENSORS
          </button>
        </div>

        {/* Chart Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'SENSORS' && (
            <div className="space-y-4">
              {/* Webcam Feed */}
              <div className="border border-line rounded-none p-2 flex flex-col h-64">
                <h3 className="font-mono text-[11px] uppercase tracking-kicker text-ink-2 mb-2">Live Camera Feed</h3>
                {hasPermissions ? (
                  <div className="flex-1 bg-subtle rounded-none overflow-hidden">
                    <video
                      ref={sensorVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center bg-subtle rounded-none">
                    <div className="text-center">
                      <Camera className="w-12 h-12 mx-auto text-ink-3 mb-2" />
                      <p className="font-sans text-sm text-ink-3">Camera permission not granted.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Mic Detection & Other Sensors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-line rounded-none p-2 flex flex-col justify-center min-h-[120px]">
                    <h3 className="font-mono text-[11px] uppercase tracking-kicker text-center text-ink-2 mb-2">Voice Activity</h3>
                  {hasPermissions ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                      <div className="flex items-end h-10 gap-px w-full justify-center">
                        {[...Array(15)].map((_, i) => {
                          const barIsActive = isVoiceActive && i < (micLevel / 120 * 15);
                          return (
                            <div
                              key={i}
                              className={`w-1.5 rounded-full transition-colors duration-75 ${barIsActive ? 'bg-brand' : 'bg-ink-3/40'}`}
                              style={{ height: `${(i / 15 * 60) + 20}%` }}
                            />
                          );
                        })}
                      </div>
                      <p className="font-mono text-[11px] uppercase tracking-kicker text-ink-3">
                        {isVoiceActive ? "Voice commands active" : "Voice commands muted"}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-subtle rounded-none">
                      <div className="text-center">
                        <MicOff className="w-8 h-8 mx-auto text-ink-3 mb-2" />
                        <p className="font-sans text-sm text-ink-3">Microphone permission not granted.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sensor Charts */}
                {['sensor3', 'sensor4'].map((sensor, index) => (
                  <div key={sensor} className="border border-line rounded-none p-2 flex flex-col h-auto min-h-[120px]">
                    <h3 className="font-mono text-[11px] uppercase tracking-kicker text-ink-2 mb-2">Sensor {index + 3}</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={sensorData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis hide />
                        <YAxis fontSize={12} stroke="#9CA3AF" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1F2937',
                            border: '1px solid #374151',
                            color: '#fff'
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey={sensor}
                          stroke={index % 2 === 1 ? '#ff6b35' : '#ffdd44'}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'MOTORS' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {['motor1', 'motor2', 'motor3', 'motor4', 'motor5', 'motor6'].map((motor, index) => (
                <div key={motor} className="border border-line rounded-none p-2 h-40">
                  <h3 className="font-mono text-[11px] uppercase tracking-kicker text-ink-2 mb-2">Motor {index + 1}</h3>
                  <ResponsiveContainer width="100%" height="80%">
                    <LineChart data={motorData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis hide />
                      <YAxis fontSize={12} stroke="#9CA3AF" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1F2937',
                          border: '1px solid #374151',
                          color: '#fff'
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey={motor}
                        stroke={index % 2 === 0 ? '#ff6b35' : '#ffdd44'}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
