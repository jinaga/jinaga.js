# Inverse Infinite Loop Bug

An infinite loop occurs when trying to invert a specification with certain matches. This bug is triggered by the structure of the matches and their conditions, particularly when existential conditions are involved.

The infinite loop occurs in `shakeTree` with the following matches:

```json
[
    {
        "unknown": {
            "name": "u1",
            "type": "GameHub.Join"
        },
        "conditions": [
            {
                "type": "existential",
                "exists": false,
                "matches": [
                    {
                        "unknown": {
                            "name": "u2",
                            "type": "GameHub.Leave"
                        },
                        "conditions": [
                            {
                                "type": "path",
                                "rolesLeft": [
                                    {
                                        "name": "join",
                                        "predecessorType": "GameHub.Join"
                                    }
                                ],
                                "labelRight": "u1",
                                "rolesRight": []
                            }
                        ]
                    }
                ]
            }
        ]
    },
    {
        "unknown": {
            "name": "p1",
            "type": "GameHub.Player"
        },
        "conditions": [
            {
                "type": "path",
                "labelRight": "u1",
                "rolesRight": [
                    {
                        "name": "player",
                        "predecessorType": "GameHub.Player"
                    }
                ],
                "rolesLeft": []
            }
        ]
    },
    {
        "unknown": {
            "name": "u3",
            "type": "GameHub.Challenge"
        },
        "conditions": [
            {
                "type": "path",
                "rolesLeft": [
                    {
                        "name": "opponentJoin",
                        "predecessorType": "GameHub.Join"
                    }
                ],
                "labelRight": "u1",
                "rolesRight": []
            }
        ]
    },
    {
        "unknown": {
            "name": "u4",
            "type": "GameHub.Join"
        },
        "conditions": [
            {
                "type": "path",
                "rolesLeft": [],
                "labelRight": "u3",
                "rolesRight": [
                    {
                        "name": "challengerJoin",
                        "predecessorType": "GameHub.Join"
                    }
                ]
            }
        ]
    },
    {
        "unknown": {
            "name": "p2",
            "type": "GameHub.Playground"
        },
        "conditions": []
    }
]
```

the label parameter is `u1`.

The call to `shakeTree` occurs as a part of a call to `invertSpecification`. The matches are part of a larger specification that describes a game challenge scenario in a game hub.

The specification that it is a part of is:

```json
{
    "given": [
        {
            "name": "p1",
            "type": "GameHub.Player"
        },
        {
            "name": "p2",
            "type": "GameHub.Playground"
        }
    ],
    "matches": [
        {
            "unknown": {
                "name": "u1",
                "type": "GameHub.Join"
            },
            "conditions": [
                {
                    "type": "path",
                    "rolesLeft": [
                        {
                            "name": "player",
                            "predecessorType": "GameHub.Player"
                        }
                    ],
                    "labelRight": "p1",
                    "rolesRight": []
                },
                {
                    "type": "existential",
                    "exists": false,
                    "matches": [
                        {
                            "unknown": {
                                "name": "u2",
                                "type": "GameHub.Leave"
                            },
                            "conditions": [
                                {
                                    "type": "path",
                                    "rolesLeft": [
                                        {
                                            "name": "join",
                                            "predecessorType": "GameHub.Join"
                                        }
                                    ],
                                    "labelRight": "u1",
                                    "rolesRight": []
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "unknown": {
                "name": "u3",
                "type": "GameHub.Challenge"
            },
            "conditions": [
                {
                    "type": "path",
                    "rolesLeft": [
                        {
                            "name": "opponentJoin",
                            "predecessorType": "GameHub.Join"
                        }
                    ],
                    "labelRight": "u1",
                    "rolesRight": []
                }
            ]
        },
        {
            "unknown": {
                "name": "u4",
                "type": "GameHub.Join"
            },
            "conditions": [
                {
                    "type": "path",
                    "rolesLeft": [],
                    "labelRight": "u3",
                    "rolesRight": [
                        {
                            "name": "challengerJoin",
                            "predecessorType": "GameHub.Join"
                        }
                    ]
                }
            ]
        }
    ],
    "projection": {
        "type": "composite",
        "components": [
            {
                "type": "hash",
                "name": "challengeId",
                "label": "u3"
            },
            {
                "type": "fact",
                "name": "challengerJoin",
                "label": "u4"
            },
            {
                "type": "specification",
                "name": "challengerName",
                "matches": [
                    {
                        "unknown": {
                            "name": "u5",
                            "type": "GameHub.Player"
                        },
                        "conditions": [
                            {
                                "type": "path",
                                "rolesLeft": [],
                                "labelRight": "u4",
                                "rolesRight": [
                                    {
                                        "name": "player",
                                        "predecessorType": "GameHub.Player"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "unknown": {
                            "name": "u6",
                            "type": "GameHub.Player.Name"
                        },
                        "conditions": [
                            {
                                "type": "path",
                                "rolesLeft": [
                                    {
                                        "name": "player",
                                        "predecessorType": "GameHub.Player"
                                    }
                                ],
                                "labelRight": "u5",
                                "rolesRight": []
                            },
                            {
                                "type": "existential",
                                "exists": false,
                                "matches": [
                                    {
                                        "unknown": {
                                            "name": "u7",
                                            "type": "GameHub.Player.Name"
                                        },
                                        "conditions": [
                                            {
                                                "type": "path",
                                                "rolesLeft": [
                                                    {
                                                        "name": "prior",
                                                        "predecessorType": "GameHub.Player.Name"
                                                    }
                                                ],
                                                "labelRight": "u6",
                                                "rolesRight": []
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ],
                "projection": {
                    "type": "field",
                    "label": "u6",
                    "field": "name"
                }
            },
            {
                "type": "field",
                "name": "challengerStarts",
                "label": "u3",
                "field": "challengerStarts"
            },
            {
                "type": "field",
                "name": "createdAt",
                "label": "u3",
                "field": "createdAt"
            },
            {
                "type": "field",
                "name": "playgroundCode",
                "label": "p2",
                "field": "code"
            }
        ]
    }
}
```
