import { injectable, inject } from 'inversify';
import { ServiceIdentifiers } from '../container/ServiceIdentifiers';

import * as estraverse from 'estraverse';
import * as ESTree from 'estree';

import { TCalleeDataExtractorFactory } from '../types/container/stack-trace-analyzer/TCalleeDataExtractorFactory';

import { ICalleeData } from '../interfaces/stack-trace-analyzer/ICalleeData';
import { IStackTraceAnalyzer } from '../interfaces/stack-trace-analyzer/IStackTraceAnalyzer';
import { IStackTraceData } from '../interfaces/stack-trace-analyzer/IStackTraceData';

import { CalleeDataExtractor } from '../enums/container/stack-trace-analyzer/CalleeDataExtractor';

import { Node } from '../node/Node';
import { NodeUtils } from '../node/NodeUtils';

/**
 * This class generates a data with a stack trace of functions calls
 *
 * For example:
 *
 * function Foo () {
 *     var baz = function () {
 *
 *     }
 *
 *     baz();
 * }
 *
 * foo();
 *
 * Will generate a structure like:
 *
 * [
 *      {
 *          callee: FOO_FUNCTION_NODE
 *          name: 'Foo',
 *          trace: [
 *              {
 *                  callee: BAZ_FUNCTION_NODE,
 *                  name: 'baz,
 *                  trace: []
 *              }
 *          ]
 *      }
 * ]
 */
@injectable()
export class StackTraceAnalyzer implements IStackTraceAnalyzer {
    /**
     * @type {CalleeDataExtractor[]}
     */
    private static readonly calleeDataExtractorsList: CalleeDataExtractor[] = [
        CalleeDataExtractor.FunctionDeclarationCalleeDataExtractor,
        CalleeDataExtractor.FunctionExpressionCalleeDataExtractor,
        CalleeDataExtractor.ObjectExpressionCalleeDataExtractor
    ];

    /**
     * @type {number}
     */
    private static readonly limitThresholdActivationLength: number = 25;

    /**
     * @type {number}
     */
    private static readonly limitThreshold: number = 0.002;

    /**
     * @type {TCalleeDataExtractorFactory}
     */
    private calleeDataExtractorFactory: TCalleeDataExtractorFactory;

    constructor (
        @inject(ServiceIdentifiers.Factory__ICalleeDataExtractor) calleeDataExtractorFactory: TCalleeDataExtractorFactory
    ) {
        this.calleeDataExtractorFactory = calleeDataExtractorFactory;
    }

    /**
     * @param {number} blockScopeBodyLength
     * @returns {number}
     */
    public static getLimitIndex (blockScopeBodyLength: number): number {
        const lastIndex: number = blockScopeBodyLength - 1;
        const limitThresholdActivationIndex: number = StackTraceAnalyzer.limitThresholdActivationLength - 1;

        let limitIndex: number = lastIndex;

        if (lastIndex > limitThresholdActivationIndex) {
            limitIndex = Math.round(
                limitThresholdActivationIndex + (lastIndex * StackTraceAnalyzer.limitThreshold)
            );

            if (limitIndex > lastIndex) {
                limitIndex = lastIndex;
            }
        }

        return limitIndex;
    }

    /**
     * @param {Node[]} blockScopeBody
     * @returns {IStackTraceData[]}
     */
    public analyze (blockScopeBody: ESTree.Node[]): IStackTraceData[] {
        return this.analyzeRecursive(blockScopeBody);
    }

    /**
     * @param {Node[]} blockScopeBody
     * @returns {IStackTraceData[]}
     */
    private analyzeRecursive (blockScopeBody: ESTree.Node[]): IStackTraceData[] {
        const limitIndex: number = StackTraceAnalyzer.getLimitIndex(blockScopeBody.length);
        const stackTraceData: IStackTraceData[] = [];
        const blockScopeBodyLength: number = blockScopeBody.length;

        for (let index: number = 0; index < blockScopeBodyLength; index++) {
            if (index > limitIndex) {
                break;
            }

            const blockScopeBodyNode: ESTree.Node = blockScopeBody[index];

            estraverse.traverse(blockScopeBodyNode, {
                enter: (node: ESTree.Node): any => {
                    if (!Node.isCallExpressionNode(node)) {
                        return;
                    }

                    if (blockScopeBodyNode.parentNode !== NodeUtils.getBlockScopesOfNode(node)[0]) {
                        return estraverse.VisitorOption.Skip;
                    }

                    this.analyzeCallExpressionNode(stackTraceData, blockScopeBody, node);
                }
            });
        }

        return stackTraceData;
    }

    /**
     * @param {IStackTraceData[]} stackTraceData
     * @param {Node[]} blockScopeBody
     * @param {CallExpression} callExpressionNode
     */
    private analyzeCallExpressionNode (
        stackTraceData: IStackTraceData[],
        blockScopeBody: ESTree.Node[],
        callExpressionNode: ESTree.CallExpression
    ): void {
        StackTraceAnalyzer.calleeDataExtractorsList.forEach((calleeDataExtractorName: CalleeDataExtractor) => {
            const calleeData: ICalleeData | null = this.calleeDataExtractorFactory(calleeDataExtractorName)
                .extract(blockScopeBody, callExpressionNode.callee);

            if (!calleeData) {
                return;
            }

            stackTraceData.push({
                ...calleeData,
                stackTrace: this.analyzeRecursive(calleeData.callee.body)
            });
        });
    }
}
