import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Svg, { G, Circle, Line, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { Colors, Fonts, FontSize } from '@/theme';
import { formatMoney } from '@/lib/format';

export interface BudgetMapNode {
  id: string; // categoryId or 'unallocated' or 'center' or 'other'
  name: string;
  allocatedPaise: number;
  spentPaise: number;
  color: string;
  isCenter?: boolean;
  isUnallocated?: boolean;
  isOverAllocated?: boolean;
}

export interface BudgetMapCanvasProps {
  mode: 'setup' | 'live';
  totalPaise: number;
  totalSpentPaise: number;
  nodes: BudgetMapNode[];
  onSelectNode: (node: BudgetMapNode) => void;
  width: number;
  height: number;
}

export default function BudgetMapCanvas({
  mode,
  totalPaise,
  totalSpentPaise,
  nodes,
  onSelectNode,
  width,
  height,
}: BudgetMapCanvasProps) {
  const centerX = width / 2;
  const centerY = height / 2;
  const orbitRadius = Math.min(width, height) * 0.35;
  const centerRadius = 46;

  // Filter out any center node from orbital positioning
  const orbitNodes = nodes.filter((n) => !n.isCenter);
  const n = orbitNodes.length;

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        {/* Orbital Guide Circle (subtle hairline) */}
        <Circle
          cx={centerX}
          cy={centerY}
          r={orbitRadius}
          stroke="rgba(232,223,207,0.06)"
          strokeWidth={1}
          fill="none"
        />

        {/* Connector Lines from Center to Category Nodes */}
        {orbitNodes.map((node, i) => {
          const angle = (2 * Math.PI / Math.max(1, n)) * i - Math.PI / 2;
          const x = centerX + orbitRadius * Math.cos(angle);
          const y = centerY + orbitRadius * Math.sin(angle);

          return (
            <Line
              key={`line-${node.id}`}
              x1={centerX}
              y1={centerY}
              x2={x}
              y2={y}
              stroke="rgba(232,223,207,0.12)"
              strokeWidth={1.5}
            />
          );
        })}

        {/* Orbital Nodes */}
        {orbitNodes.map((node, i) => {
          const angle = (2 * Math.PI / Math.max(1, n)) * i - Math.PI / 2;
          const x = centerX + orbitRadius * Math.cos(angle);
          const y = centerY + orbitRadius * Math.sin(angle);

          // Node radius proportional to allocation fraction
          const fraction =
            totalPaise > 0 ? node.allocatedPaise / totalPaise : 0;
          const nodeRadius = node.isUnallocated
            ? 28
            : Math.min(44, Math.max(26, 26 + Math.sqrt(fraction) * 26));

          // In live mode, calculate progress ring parameters
          const progress =
            node.allocatedPaise > 0
              ? Math.min(1.2, node.spentPaise / node.allocatedPaise)
              : 0;
          const ringRadius = nodeRadius + 4;
          const circumference = 2 * Math.PI * ringRadius;
          const strokeDash = Math.min(circumference, circumference * progress);

          let progressColor: string = Colors.income;
          if (progress > 1.0) {
            progressColor = Colors.overBudget;
          } else if (progress > 0.8) {
            progressColor = '#D97706'; // warning amber
          }

          return (
            <G
              key={`node-${node.id}`}
              onPress={() => {
                Haptics.selectionAsync();
                onSelectNode(node);
              }}
            >
              {/* Invisible larger hit target */}
              <Circle cx={x} cy={y} r={nodeRadius + 14} fill="transparent" />

              {/* Progress Ring in Live Mode */}
              {mode === 'live' && !node.isUnallocated && node.allocatedPaise > 0 && (
                <>
                  {/* Track */}
                  <Circle
                    cx={x}
                    cy={y}
                    r={ringRadius}
                    stroke="rgba(232,223,207,0.10)"
                    strokeWidth={3}
                    fill="none"
                  />
                  {/* Progress Arc */}
                  <Circle
                    cx={x}
                    cy={y}
                    r={ringRadius}
                    stroke={progressColor}
                    strokeWidth={3}
                    strokeDasharray={`${strokeDash} ${circumference}`}
                    strokeDashoffset={0}
                    strokeLinecap="round"
                    fill="none"
                    transform={`rotate(-90 ${x} ${y})`}
                  />
                </>
              )}

              {/* Node Main Circle */}
              <Circle
                cx={x}
                cy={y}
                r={nodeRadius}
                fill={node.isUnallocated ? Colors.surface2 : node.color + '2E'}
                stroke={
                  node.isUnallocated
                    ? node.isOverAllocated
                      ? Colors.overBudget
                      : Colors.income
                    : node.color
                }
                strokeWidth={1.5}
                strokeDasharray={node.isUnallocated ? '4 3' : undefined}
              />

              {/* Node Name Label */}
              <SvgText
                x={x}
                y={y - 4}
                textAnchor="middle"
                fontSize={FontSize.xs}
                fontWeight="600"
                fill={Colors.text}
              >
                {node.name.length > 9 ? `${node.name.slice(0, 8)}…` : node.name}
              </SvgText>

              {/* Node Amount Label */}
              <SvgText
                x={x}
                y={y + 10}
                textAnchor="middle"
                fontSize={10}
                fontWeight="500"
                fill={
                  node.isUnallocated
                    ? node.isOverAllocated
                      ? Colors.overBudget
                      : Colors.income
                    : Colors.text2
                }
              >
                {formatMoney(
                  mode === 'live' && !node.isUnallocated
                    ? node.allocatedPaise - node.spentPaise
                    : node.allocatedPaise,
                  { compact: true }
                )}
              </SvgText>
            </G>
          );
        })}

        {/* Center Node (Total Budget Hub) */}
        <G
          onPress={() => {
            Haptics.selectionAsync();
            onSelectNode({
              id: 'center',
              name: 'Total Budget',
              allocatedPaise: totalPaise,
              spentPaise: totalSpentPaise,
              color: Colors.accent,
              isCenter: true,
            });
          }}
        >
          {/* Outer glow ring */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={centerRadius + 4}
            stroke={Colors.accentLight}
            strokeWidth={1}
            strokeDasharray="4 4"
            fill="none"
          />

          {/* Center Circle */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={centerRadius}
            fill={Colors.surface}
            stroke={Colors.accent}
            strokeWidth={2}
          />

          {/* Center Text */}
          <SvgText
            x={centerX}
            y={centerY - 10}
            textAnchor="middle"
            fontSize={FontSize.xs}
            fontWeight="500"
            fill={Colors.muted}
          >
            {mode === 'setup' ? 'TOTAL BUDGET' : 'LEFT TO SPEND'}
          </SvgText>

          <SvgText
            x={centerX}
            y={centerY + 8}
            textAnchor="middle"
            fontSize={FontSize.md}
            fontWeight="700"
            fill={
              mode === 'live' && totalSpentPaise > totalPaise
                ? Colors.overBudget
                : Colors.text
            }
          >
            {formatMoney(
              mode === 'setup'
                ? totalPaise
                : Math.max(0, totalPaise - totalSpentPaise),
              { compact: true }
            )}
          </SvgText>

          <SvgText
            x={centerX}
            y={centerY + 22}
            textAnchor="middle"
            fontSize={9}
            fontWeight="500"
            fill={Colors.text2}
          >
            {mode === 'setup' ? 'Tap to edit' : `${orbitNodes.length} categories`}
          </SvgText>
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
